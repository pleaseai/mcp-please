/**
 * Tool Executor Service
 * Unified tool execution logic shared between CLI and MCP server
 */

import type { PersistedIndex } from '@pleaseai/mcp-core'
import type { CallToolResult } from '../utils/mcp-client.js'
import type { McpServerConfigWithAuth } from '../utils/mcp-config-loader.js'
import { callToolOnMcpServer } from '../utils/mcp-client.js'
import { getAllMcpServers } from '../utils/mcp-config-loader.js'
import { OAuthManager, TokenStorage } from '../utils/oauth/index.js'

/**
 * Error codes for tool execution failures
 */
export type ToolExecutorErrorCode
  = 'TOOL_NOT_FOUND'
    | 'METADATA_MISSING'
    | 'SERVER_NOT_CONFIGURED'
    | 'AUTH_REQUIRED'
    | 'EXECUTION_FAILED'

/**
 * Successful tool execution result
 */
export interface ExecuteToolSuccess {
  success: true
  result: CallToolResult
  toolName: string
  originalName: string
  serverName: string
}

/**
 * Failed tool execution result
 */
export interface ExecuteToolError {
  success: false
  error: ToolExecutorErrorCode
  message: string
  hint?: string
}

/**
 * Tool execution result (discriminated union)
 */
export type ExecuteToolResult = ExecuteToolSuccess | ExecuteToolError

/**
 * Configuration for ToolExecutor
 */
export interface ToolExecutorConfig {
  /**
   * Function to get the persisted index
   * This allows lazy loading and caching at the caller's discretion
   */
  getIndex: () => Promise<PersistedIndex>
}

/**
 * Tool Executor Service
 *
 * Handles the full lifecycle of tool execution:
 * 1. Resolve tool from index by name
 * 2. Extract server metadata
 * 3. Resolve server configuration
 * 4. Handle OAuth/bearer token retrieval
 * 5. Execute tool via MCP client
 * 6. Return typed result
 */
export class ToolExecutor {
  private config: ToolExecutorConfig

  constructor(config: ToolExecutorConfig) {
    this.config = config
  }

  /**
   * Execute a tool by name with provided arguments
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExecuteToolResult> {
    // Step 1: Load index and find tool
    const index = await this.config.getIndex()
    const indexedTool = index.tools.find(t => t.tool.name === toolName)

    if (!indexedTool) {
      return {
        success: false,
        error: 'TOOL_NOT_FOUND',
        message: `Tool '${toolName}' not found in index`,
        hint: 'Use search_tools to find available tools',
      }
    }

    // Step 2: Extract server metadata
    const serverName = indexedTool.tool.metadata?.server as string | undefined
    const originalName = indexedTool.tool.metadata?.originalName as string | undefined

    if (!serverName || !originalName) {
      return {
        success: false,
        error: 'METADATA_MISSING',
        message: 'Tool metadata missing server information',
        hint: 'Re-index from MCP servers to populate metadata',
      }
    }

    // Step 3: Get server configuration
    const allServers = getAllMcpServers()
    const serverConfig = allServers.get(serverName)

    if (!serverConfig) {
      return {
        success: false,
        error: 'SERVER_NOT_CONFIGURED',
        message: `Server '${serverName}' not found in configuration`,
        hint: `Add server to .please/mcp.json or run: mcp-search mcp add ${serverName}`,
      }
    }

    // Step 4: Resolve authentication
    const authResult = await this.resolveAuth(serverName, serverConfig)
    if (!authResult.success) {
      return authResult
    }

    // Step 5: Execute tool
    try {
      const result = await callToolOnMcpServer({
        name: serverName,
        config: serverConfig,
        accessToken: authResult.accessToken,
        toolName: originalName,
        toolArguments: args,
      })

      return {
        success: true,
        result,
        toolName,
        originalName,
        serverName,
      }
    }
    catch (err) {
      return {
        success: false,
        error: 'EXECUTION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Resolve authentication for a server
   */
  private async resolveAuth(
    serverName: string,
    serverConfig: McpServerConfigWithAuth,
  ): Promise<{ success: true, accessToken?: string } | ExecuteToolError> {
    // OAuth 2.0 authentication
    if (serverConfig.authorization?.type === 'oauth2' && serverConfig.url) {
      const tokenStorage = new TokenStorage()
      const hasSession = await tokenStorage.hasSession(serverConfig.url)

      if (hasSession) {
        const oauthManager = new OAuthManager({
          serverName,
          serverUrl: serverConfig.url,
          scopes: serverConfig.authorization.oauth?.scopes,
        })
        const accessToken = await oauthManager.getAccessToken()
        return { success: true, accessToken }
      }

      return {
        success: false,
        error: 'AUTH_REQUIRED',
        message: `No valid OAuth session for '${serverName}'`,
        hint: `Run: mcp-search mcp auth ${serverName}`,
      }
    }

    // Bearer token authentication
    if (serverConfig.authorization?.type === 'bearer') {
      return { success: true, accessToken: serverConfig.authorization.token }
    }

    // No authentication required
    return { success: true }
  }
}

/**
 * Create a ToolExecutor with default configuration
 */
export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return new ToolExecutor(config)
}
