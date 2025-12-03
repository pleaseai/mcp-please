/**
 * Secure token storage for OAuth sessions
 * Stores tokens in ~/.please/oauth/tokens/<server-hash>.json
 */

import type { OAuthClientInfo, OAuthSession, OAuthTokenResponse } from './types.js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CONFIG_DIR = join(homedir(), '.please', 'oauth')

/**
 * Generate a hash for the server URL to use as filename
 */
function getServerHash(serverUrl: string): string {
  return createHash('md5').update(serverUrl).digest('hex').substring(0, 12)
}

/**
 * Token storage for managing OAuth sessions
 */
export class TokenStorage {
  private configDir: string

  constructor(configDir?: string) {
    this.configDir = configDir ?? DEFAULT_CONFIG_DIR
  }

  /**
   * Get the path to the token file for a server
   */
  private getTokenPath(serverUrl: string): string {
    const hash = getServerHash(serverUrl)
    return join(this.configDir, 'tokens', `${hash}.json`)
  }

  /**
   * Get the path to the client info file for a server
   */
  private getClientPath(serverUrl: string): string {
    const hash = getServerHash(serverUrl)
    return join(this.configDir, 'clients', `${hash}.json`)
  }

  /**
   * Ensure the storage directory exists with proper permissions
   */
  private async ensureDir(path: string): Promise<void> {
    const dir = join(path, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
    }
  }

  /**
   * Load saved session from disk
   * @param serverUrl - The server URL to load session for
   * @param includeExpired - If true, returns expired sessions (for refresh token use)
   */
  async loadSession(serverUrl: string, includeExpired = false): Promise<OAuthSession | undefined> {
    const tokenPath = this.getTokenPath(serverUrl)

    if (!existsSync(tokenPath)) {
      return undefined
    }

    try {
      const content = await readFile(tokenPath, 'utf-8')
      const session = JSON.parse(content) as OAuthSession

      // Check if token is expired (unless includeExpired is true)
      if (!includeExpired && session.expiresAt && Date.now() >= session.expiresAt) {
        return undefined
      }

      return session
    }
    catch {
      return undefined
    }
  }

  /**
   * Save session to disk with secure permissions
   */
  async saveSession(serverUrl: string, session: OAuthSession): Promise<void> {
    const tokenPath = this.getTokenPath(serverUrl)
    await this.ensureDir(tokenPath)
    await writeFile(tokenPath, JSON.stringify(session, null, 2), 'utf-8')
    await chmod(tokenPath, 0o600)
  }

  /**
   * Update tokens in existing session
   */
  async updateTokens(serverUrl: string, tokens: OAuthTokenResponse): Promise<void> {
    const session = await this.loadSession(serverUrl)
    if (!session) {
      throw new Error('No session found to update')
    }

    session.tokens = tokens
    session.expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined

    await this.saveSession(serverUrl, session)
  }

  /**
   * Clear saved session
   */
  async clearSession(serverUrl: string): Promise<void> {
    const tokenPath = this.getTokenPath(serverUrl)
    if (existsSync(tokenPath)) {
      await unlink(tokenPath)
    }
  }

  /**
   * Load saved client info (from dynamic registration)
   */
  async loadClientInfo(serverUrl: string): Promise<OAuthClientInfo | undefined> {
    const clientPath = this.getClientPath(serverUrl)

    if (!existsSync(clientPath)) {
      return undefined
    }

    try {
      const content = await readFile(clientPath, 'utf-8')
      return JSON.parse(content) as OAuthClientInfo
    }
    catch {
      return undefined
    }
  }

  /**
   * Save client info from dynamic registration
   */
  async saveClientInfo(serverUrl: string, clientInfo: OAuthClientInfo): Promise<void> {
    const clientPath = this.getClientPath(serverUrl)
    await this.ensureDir(clientPath)
    await writeFile(clientPath, JSON.stringify(clientInfo, null, 2), 'utf-8')
    await chmod(clientPath, 0o600)
  }

  /**
   * Check if a valid (non-expired) session exists for a server
   */
  async hasValidSession(serverUrl: string): Promise<boolean> {
    const session = await this.loadSession(serverUrl)
    return session !== undefined
  }

  /**
   * Check if any session exists (including expired ones with refresh tokens)
   */
  async hasSession(serverUrl: string): Promise<boolean> {
    const tokenPath = this.getTokenPath(serverUrl)
    if (!existsSync(tokenPath)) {
      return false
    }

    try {
      const content = await readFile(tokenPath, 'utf-8')
      const session = JSON.parse(content) as OAuthSession
      // Session exists if we have tokens (can be refreshed even if expired)
      return !!(session.tokens && (session.tokens.access_token || session.tokens.refresh_token))
    }
    catch {
      return false
    }
  }

  /**
   * Check if token needs refresh (within 5 minutes of expiry)
   */
  async needsRefresh(serverUrl: string): Promise<boolean> {
    const session = await this.loadSession(serverUrl)
    if (!session) {
      return true
    }

    if (!session.expiresAt) {
      return false
    }

    // Refresh if within 5 minutes of expiry
    const REFRESH_BUFFER = 5 * 60 * 1000
    return Date.now() >= session.expiresAt - REFRESH_BUFFER
  }
}
