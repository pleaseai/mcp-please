/**
 * OAuth Manager for handling MCP OAuth 2.1 flows
 * Supports RFC 8414 (metadata discovery), RFC 7591 (dynamic registration), RFC 7636 (PKCE)
 */

import type { Server } from 'node:http'
import type {
  OAuthClientInfo,
  OAuthClientRegistrationRequest,
  OAuthConfig,
  OAuthLogger,
  OAuthMetadata,
  OAuthSession,
  OAuthTokenResponse,
  ProtectedResourceMetadata,
} from './types.js'
import { createServer } from 'node:http'
import open from 'open'
import { generatePKCE, generateState } from './pkce.js'
import { TokenStorage } from './token-storage.js'

const DEFAULT_CALLBACK_PORT = 3334
const DEFAULT_CALLBACK_HOST = 'localhost'
const AUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_PORT_ATTEMPTS = 10

/**
 * Simple console logger that respects debug flag
 */
function createConsoleLogger(debug: boolean): OAuthLogger {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[oauth] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[oauth] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[oauth] ${msg}`, ...args),
    debug: (msg: string, ...args: unknown[]) => {
      if (debug)
        console.log(`[oauth:debug] ${msg}`, ...args)
    },
  }
}

/**
 * Internal config type with resolved defaults
 */
interface ResolvedOAuthConfig {
  serverName: string
  serverUrl: string
  callbackPort: number
  callbackHost: string
  configDir?: string
  staticClientInfo?: OAuthClientInfo
  scopes?: string[]
}

/**
 * OAuth Manager for MCP authentication
 */
export class OAuthManager {
  private config: ResolvedOAuthConfig
  private logger: OAuthLogger
  private storage: TokenStorage
  private metadata?: OAuthMetadata
  private session?: OAuthSession
  private actualCallbackPort?: number

  constructor(config: OAuthConfig, options?: { debug?: boolean, logger?: OAuthLogger }) {
    this.config = {
      serverName: config.serverName,
      serverUrl: config.serverUrl,
      callbackPort: config.callbackPort ?? DEFAULT_CALLBACK_PORT,
      callbackHost: config.callbackHost ?? DEFAULT_CALLBACK_HOST,
      configDir: config.configDir,
      staticClientInfo: config.staticClientInfo,
      scopes: config.scopes,
    }

    this.logger = options?.logger ?? createConsoleLogger(options?.debug ?? false)
    this.storage = new TokenStorage(config.configDir)
  }

  /**
   * Get the authorization base URL from the server URL
   */
  private getAuthBaseUrl(): string {
    const url = new URL(this.config.serverUrl)
    return `${url.protocol}//${url.host}`
  }

  /**
   * Get the callback port to use (actual port if found, otherwise configured port)
   */
  private getCallbackPort(): number {
    return this.actualCallbackPort ?? this.config.callbackPort
  }

  /**
   * Check if a port is available for binding
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') {
          this.logger.debug(`Port ${port} check failed: ${err.code} - ${err.message}`)
        }
        resolve(false)
      })
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, this.config.callbackHost)
    })
  }

  /**
   * Find an available port starting from the configured callback port
   * Tries up to MAX_PORT_ATTEMPTS consecutive ports
   */
  private async findAvailablePort(): Promise<number> {
    const basePort = this.config.callbackPort
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const port = basePort + attempt
      if (await this.isPortAvailable(port)) {
        if (attempt > 0) {
          this.logger.warn(`Port ${basePort} in use, using port ${port}`)
        }
        return port
      }
    }
    const lastPort = basePort + MAX_PORT_ATTEMPTS - 1
    throw new Error(`All ports ${basePort}-${lastPort} are in use. Please close other applications using these ports.`)
  }

  /**
   * Discover protected resource metadata (RFC 9728)
   */
  async discoverProtectedResource(): Promise<ProtectedResourceMetadata | undefined> {
    const baseUrl = this.getAuthBaseUrl()
    const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`

    this.logger.debug(`Discovering protected resource metadata from: ${metadataUrl}`)

    try {
      const response = await fetch(metadataUrl, {
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        const metadata = await response.json() as ProtectedResourceMetadata
        this.logger.debug('Protected resource metadata discovered')
        return metadata
      }
    }
    catch (error) {
      this.logger.debug('Protected resource metadata discovery failed:', error)
    }

    return undefined
  }

  /**
   * Discover OAuth metadata from the server (RFC 8414)
   */
  async discoverMetadata(authorizationServer?: string): Promise<OAuthMetadata> {
    const baseUrl = authorizationServer ?? this.getAuthBaseUrl()
    const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`

    this.logger.debug(`Discovering OAuth metadata from: ${metadataUrl}`)

    try {
      const response = await fetch(metadataUrl, {
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        const metadata = await response.json() as OAuthMetadata
        this.logger.info('OAuth metadata discovered successfully')
        this.metadata = metadata
        return metadata
      }
    }
    catch (error) {
      this.logger.debug('Metadata discovery failed, using defaults:', error)
    }

    // Fall back to default endpoints
    this.logger.info('Using default OAuth endpoints')
    this.metadata = {
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
    }

    return this.metadata
  }

  /**
   * Register a dynamic OAuth client (RFC 7591)
   */
  private async registerClient(metadata: OAuthMetadata): Promise<OAuthClientInfo> {
    if (!metadata.registration_endpoint) {
      throw new Error('Dynamic client registration not supported by server')
    }

    // Check if we have cached client info
    const cachedClient = await this.storage.loadClientInfo(this.config.serverUrl)
    if (cachedClient) {
      this.logger.debug('Using cached client info')
      return cachedClient
    }

    this.logger.info('Registering dynamic OAuth client')

    const redirectUri = `http://${this.config.callbackHost}:${this.getCallbackPort()}/callback`

    // Build registration request (don't specify PKCE here - it's per-authorization-request)
    const registrationRequest: OAuthClientRegistrationRequest = {
      client_name: `mcp-gateway (${this.config.serverName})`,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
    }

    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationRequest),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Client registration failed: ${error}`)
    }

    const clientInfo = await response.json() as OAuthClientInfo
    this.logger.info('OAuth client registered successfully')

    // Cache client info
    await this.storage.saveClientInfo(this.config.serverUrl, clientInfo)

    return clientInfo
  }

  /**
   * Check if server supports PKCE with S256 method
   */
  private serverSupportsPKCE(metadata: OAuthMetadata): boolean {
    const methods = metadata.code_challenge_methods_supported
    return Array.isArray(methods) && methods.includes('S256')
  }

  /**
   * Start local callback server and perform authorization flow
   */
  private async performAuthorizationFlow(
    metadata: OAuthMetadata,
    clientInfo: OAuthClientInfo,
  ): Promise<OAuthTokenResponse> {
    const state = generateState()
    const redirectUri = `http://${this.config.callbackHost}:${this.getCallbackPort()}/callback`

    // Check if server supports PKCE
    const usePKCE = this.serverSupportsPKCE(metadata)
    let verifier: string | undefined
    let challenge: string | undefined

    this.logger.info(`PKCE check: code_challenge_methods_supported=${JSON.stringify(metadata.code_challenge_methods_supported)}, usePKCE=${usePKCE}`)

    if (usePKCE) {
      const pkce = generatePKCE()
      verifier = pkce.verifier
      challenge = pkce.challenge
      this.logger.info('PKCE enabled (server supports S256)')
    }
    else {
      this.logger.info('PKCE disabled (server does not advertise S256 support)')
    }

    // Build authorization URL
    const authUrl = new URL(metadata.authorization_endpoint)
    authUrl.searchParams.set('client_id', clientInfo.client_id)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('state', state)

    // Only add PKCE parameters if server supports it
    if (usePKCE && challenge) {
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
    }

    // Force consent screen to ensure fresh authorization with current PKCE challenge
    authUrl.searchParams.set('prompt', 'consent')

    if (this.config.scopes && this.config.scopes.length > 0) {
      authUrl.searchParams.set('scope', this.config.scopes.join(' '))
    }

    this.logger.info(`Starting authorization flow for ${this.config.serverName}`)
    this.logger.info(`Authorization URL: ${authUrl.toString()}`)

    // Start local callback server and open browser with correct URL
    const authCode = await this.waitForCallback(state, authUrl.toString())

    this.logger.info('Authorization code received')

    // Build token exchange parameters
    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientInfo.client_id,
    }

    // Only include code_verifier if PKCE was used
    if (usePKCE && verifier) {
      tokenParams.code_verifier = verifier
    }

    this.logger.info(`Token exchange params: ${JSON.stringify({ ...tokenParams, code: '[redacted]', code_verifier: tokenParams.code_verifier ? '[set]' : '[not set]' })}`)

    // Exchange code for tokens
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${error}`)
    }

    const tokens = await tokenResponse.json() as OAuthTokenResponse
    this.logger.info('Access token obtained successfully')

    return tokens
  }

  /**
   * Wait for OAuth callback with authorization code
   */
  private waitForCallback(expectedState: string, authorizationUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let server: Server | undefined

      const timeout = setTimeout(() => {
        server?.close()
        reject(new Error('Authorization timeout'))
      }, AUTH_TIMEOUT_MS)

      const callbackPort = this.getCallbackPort()

      server = createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://${this.config.callbackHost}:${callbackPort}`)

        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const state = url.searchParams.get('state')

        // Verify state
        if (state !== expectedState) {
          res.writeHead(400)
          res.end('<html><body><h1>Invalid state parameter</h1></body></html>')
          clearTimeout(timeout)
          server?.close()
          reject(new Error('Invalid state parameter - possible CSRF attack'))
          return
        }

        if (error) {
          res.writeHead(400)
          res.end(`<html><body><h1>Authorization failed: ${error}</h1></body></html>`)
          clearTimeout(timeout)
          server?.close()
          reject(new Error(`Authorization failed: ${error}`))
          return
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Authorization successful!</h1><p>You can close this window.</p></body></html>')
          clearTimeout(timeout)
          setTimeout(() => server?.close(), 500)
          resolve(code)
          return
        }

        res.writeHead(400)
        res.end('<html><body><h1>Invalid callback: missing code</h1></body></html>')
        clearTimeout(timeout)
        server?.close()
        reject(new Error('Invalid callback: missing code'))
      })

      server.listen(callbackPort, () => {
        this.logger.info(`Callback server listening on port ${callbackPort}`)

        // Open browser with the provided authorization URL (includes PKCE parameters)
        open(authorizationUrl).catch((err) => {
          this.logger.warn('Failed to open browser automatically:', err)
          this.logger.info(`Please open this URL in your browser:\n${authorizationUrl}`)
        })
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout)
        if (err.code === 'EADDRINUSE') {
          this.logger.warn(`Port ${callbackPort} became unavailable (race condition)`)
          reject(new Error(`Port ${callbackPort} became unavailable. Please try again.`))
        }
        else {
          reject(err)
        }
      })
    })
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<OAuthTokenResponse> {
    if (!this.metadata || !this.session) {
      throw new Error('Cannot refresh token: no active session')
    }

    if (!this.session.tokens.refresh_token) {
      throw new Error('No refresh token available')
    }

    this.logger.info('Refreshing access token')

    const response = await fetch(this.metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.session.tokens.refresh_token,
        client_id: this.session.clientInfo.client_id,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token refresh failed: ${error}`)
    }

    const tokens = await response.json() as OAuthTokenResponse
    this.logger.info('Access token refreshed successfully')

    return tokens
  }

  /**
   * Perform complete OAuth authorization and return access token
   */
  async authorize(): Promise<string> {
    // Try to load saved session
    this.session = await this.storage.loadSession(this.config.serverUrl)
    if (this.session) {
      this.logger.info('Using saved OAuth session')

      // Check if refresh is needed
      if (await this.storage.needsRefresh(this.config.serverUrl)) {
        try {
          await this.discoverMetadata()
          const tokens = await this.refreshAccessToken()
          this.session.tokens = tokens
          this.session.expiresAt = tokens.expires_in
            ? Date.now() + tokens.expires_in * 1000
            : undefined
          await this.storage.saveSession(this.config.serverUrl, this.session)
        }
        catch (error) {
          this.logger.warn('Token refresh failed, re-authorizing:', error)
          this.session = undefined
        }
      }

      if (this.session) {
        return this.session.tokens.access_token
      }
    }

    // Find an available port for the callback server before any registration
    this.actualCallbackPort = await this.findAvailablePort()
    this.logger.info(`Using callback port ${this.actualCallbackPort}`)

    // Discover protected resource metadata first (RFC 9728)
    const resourceMetadata = await this.discoverProtectedResource()
    const authorizationServer = resourceMetadata?.authorization_servers?.[0]

    // Discover OAuth metadata
    const metadata = await this.discoverMetadata(authorizationServer)

    // Get or register client
    let clientInfo = this.config.staticClientInfo
    if (!clientInfo) {
      clientInfo = await this.registerClient(metadata)
    }

    // Store client info for callback
    this.session = {
      clientInfo,
      tokens: { access_token: '', token_type: 'Bearer' },
    }

    // Perform authorization flow
    const tokens = await this.performAuthorizationFlow(metadata, clientInfo)

    // Calculate expiration time
    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined

    // Save session
    this.session = {
      clientInfo,
      tokens,
      expiresAt,
    }
    await this.storage.saveSession(this.config.serverUrl, this.session)

    return tokens.access_token
  }

  /**
   * Get current access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    // Try to load session including expired ones (for refresh token use)
    if (!this.session) {
      this.session = await this.storage.loadSession(this.config.serverUrl, true)
    }

    if (!this.session) {
      return this.authorize()
    }

    // Check if token needs refresh
    if (await this.storage.needsRefresh(this.config.serverUrl)) {
      try {
        if (!this.metadata) {
          await this.discoverMetadata()
        }
        const tokens = await this.refreshAccessToken()
        this.session.tokens = tokens
        this.session.expiresAt = tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined
        await this.storage.saveSession(this.config.serverUrl, this.session)
        this.logger.info('Token refreshed successfully')
      }
      catch (error) {
        this.logger.warn('Token refresh failed, re-authorizing:', error)
        return this.authorize()
      }
    }

    return this.session.tokens.access_token
  }

  /**
   * Clear saved session
   */
  async clearSession(): Promise<void> {
    this.session = undefined
    await this.storage.clearSession(this.config.serverUrl)
    this.logger.info('Session cleared')
  }

  /**
   * Check if a valid session exists
   */
  async hasValidSession(): Promise<boolean> {
    return this.storage.hasValidSession(this.config.serverUrl)
  }
}
