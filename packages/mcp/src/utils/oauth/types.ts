/**
 * OAuth 2.1 types for MCP authentication
 * Based on RFC 8414, RFC 9728, RFC 7591
 */

/**
 * OAuth server metadata (RFC 8414)
 */
export interface OAuthMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  revocation_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  code_challenge_methods_supported?: string[]
}

/**
 * Protected resource metadata (RFC 9728)
 */
export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers?: string[]
  scopes_supported?: string[]
  bearer_methods_supported?: string[]
  resource_documentation?: string
  resource_name?: string
}

/**
 * OAuth client information
 */
export interface OAuthClientInfo {
  client_id: string
  client_secret?: string
}

/**
 * OAuth dynamic client registration request (RFC 7591)
 */
export interface OAuthClientRegistrationRequest {
  client_name: string
  redirect_uris: string[]
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
  code_challenge_method?: 'plain' | 'S256'
}

/**
 * OAuth token response
 */
export interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

/**
 * Stored OAuth session
 */
export interface OAuthSession {
  clientInfo: OAuthClientInfo
  tokens: OAuthTokenResponse
  expiresAt?: number
}

/**
 * OAuth configuration for a server
 */
export interface OAuthConfig {
  serverName: string
  serverUrl: string
  callbackPort?: number
  callbackHost?: string
  staticClientInfo?: OAuthClientInfo
  scopes?: string[]
  configDir?: string
}

/**
 * Authorization type
 */
export type AuthorizationType = 'none' | 'bearer' | 'oauth2'

/**
 * Authorization configuration for MCP server
 */
export interface AuthorizationConfig {
  type: AuthorizationType

  /** For bearer: static token or environment variable reference */
  token?: string

  /** For oauth2: OAuth configuration */
  oauth?: {
    clientId?: string
    clientSecret?: string
    authorizationServer?: string
    scopes?: string[]
    resource?: string
  }
}

/**
 * Logger interface for OAuth operations
 */
export interface OAuthLogger {
  info: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}
