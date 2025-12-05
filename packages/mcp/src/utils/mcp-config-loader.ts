/**
 * MCP configuration loader
 * Reads MCP server configs from .please/mcp.json and ~/.please/mcp.json
 */

import type { ToolDefinition } from '@pleaseai/mcp-core'
import type { McpServerConfig } from './mcp-client.js'
import type { AuthorizationConfig } from './oauth/index.js'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fetchToolsFromMcpServer } from './mcp-client.js'
import { OAuthManager, TokenStorage } from './oauth/index.js'

export interface McpServerConfigWithAuth extends McpServerConfig {
  authorization?: AuthorizationConfig
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfigWithAuth>
}

type ScopeType = 'local' | 'project' | 'user'

/**
 * Get config file path based on scope
 */
function getConfigPath(scope: ScopeType, cwd: string): string {
  const home = homedir()

  switch (scope) {
    case 'project':
      return join(cwd, '.please', 'mcp.json')
    case 'user':
      return join(home, '.please', 'mcp.json')
    case 'local':
    default:
      return join(cwd, '.please', 'mcp.local.json')
  }
}

/**
 * Read MCP config from file
 */
function readConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) {
    return { mcpServers: {} }
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return {
      mcpServers: parsed.mcpServers || {},
    }
  }
  catch {
    return { mcpServers: {} }
  }
}

/**
 * Get all MCP servers from config scopes.
 *
 * @param cwd - Current working directory
 * @param indexScope - Optional index scope to filter configs:
 *   - 'project': reads user + project + local configs (default behavior)
 *   - 'user': reads only user config
 *   - undefined: reads all configs (backward compatible)
 */
export function getAllMcpServers(
  cwd: string = process.cwd(),
  indexScope?: 'project' | 'user',
): Map<string, McpServerConfigWithAuth> {
  const servers = new Map<string, McpServerConfigWithAuth>()

  // Determine which scopes to read based on indexScope
  const scopes: ScopeType[] = indexScope === 'user'
    ? ['user'] // User scope: user config only
    : ['user', 'project', 'local'] // Project scope or default: all configs

  for (const scope of scopes) {
    const configPath = getConfigPath(scope, cwd)
    if (existsSync(configPath)) {
      const config = readConfig(configPath)
      for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
        servers.set(name, serverConfig)
      }
    }
  }

  return servers
}

export interface LoadToolsOptions {
  /** Specific server names to load (all if not specified) */
  servers?: string[]
  /** Servers to exclude */
  exclude?: string[]
  /** Index scope to filter which configs to load from */
  indexScope?: 'project' | 'user'
  /** Callback for progress updates */
  onProgress?: (serverName: string, status: 'connecting' | 'authenticating' | 'fetching' | 'done' | 'error', toolCount?: number) => void
  /** Callback for errors (non-fatal) */
  onError?: (serverName: string, error: Error) => void
}

/**
 * Load tools from configured MCP servers
 */
export async function loadToolsFromMcpServers(options: LoadToolsOptions = {}): Promise<ToolDefinition[]> {
  const allServers = getAllMcpServers(process.cwd(), options.indexScope)
  const tokenStorage = new TokenStorage()
  const allTools: ToolDefinition[] = []

  for (const [name, config] of allServers) {
    // Filter by server names if specified
    if (options.servers && !options.servers.includes(name)) {
      continue
    }

    // Exclude specified servers
    if (options.exclude && options.exclude.includes(name)) {
      continue
    }

    try {
      options.onProgress?.(name, 'connecting')

      // Get access token for OAuth servers
      let accessToken: string | undefined

      if (config.authorization?.type === 'oauth2' && config.url) {
        options.onProgress?.(name, 'authenticating')

        // Check for existing token (including expired ones with refresh tokens)
        const hasSession = await tokenStorage.hasSession(config.url)

        if (hasSession) {
          const oauthManager = new OAuthManager({
            serverName: name,
            serverUrl: config.url,
            scopes: config.authorization.oauth?.scopes,
          })
          // getAccessToken will automatically refresh if needed
          accessToken = await oauthManager.getAccessToken()
        }
        else {
          throw new Error(`No valid OAuth session for "${name}". Run: mcp-gateway mcp auth ${name}`)
        }
      }
      else if (config.authorization?.type === 'bearer') {
        accessToken = config.authorization.token
      }

      options.onProgress?.(name, 'fetching')

      const tools = await fetchToolsFromMcpServer({
        name,
        config,
        accessToken,
      })

      allTools.push(...tools)
      options.onProgress?.(name, 'done', tools.length)
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      options.onError?.(name, err)
      options.onProgress?.(name, 'error')
    }
  }

  return allTools
}
