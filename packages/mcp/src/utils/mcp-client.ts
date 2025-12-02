import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolDefinition } from '@pleaseai/mcp-core'
import type { McpServerConfig, MergedServerEntry } from './mcp-config.js'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * Result of tool discovery from a single server
 */
export interface ServerToolsResult {
  serverName: string
  source: 'user' | 'project' | 'local'
  tools: ToolDefinition[]
  error?: string
}

/**
 * Options for tool discovery
 */
export interface DiscoverToolsOptions {
  timeout?: number
  onProgress?: (serverName: string, status: 'connecting' | 'listing' | 'done' | 'error') => void
  excludeServers?: string[]
}

/**
 * Create transport based on server configuration
 */
function createTransport(config: McpServerConfig): Transport {
  const transport = config.transport || (config.url ? 'http' : 'stdio')

  if (transport === 'http' && config.url) {
    return new StreamableHTTPClientTransport(new URL(config.url))
  }
  else if (transport === 'sse' && config.url) {
    return new SSEClientTransport(new URL(config.url))
  }
  else if (config.command) {
    // Merge environment variables - filter out undefined values
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    if (config.env) {
      Object.assign(env, config.env)
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env,
    })
  }

  throw new Error('Invalid server configuration: missing command or url')
}

/**
 * Connect to an MCP server and list its tools
 */
async function listToolsFromServer(
  serverName: string,
  config: McpServerConfig,
  timeout: number = 30000,
): Promise<ToolDefinition[]> {
  const client = new Client({
    name: 'pleaseai-mcp-indexer',
    version: '1.0.0',
  })

  const transport = createTransport(config)

  try {
    // Connect with timeout
    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout),
    )

    await Promise.race([connectPromise, timeoutPromise])

    // List tools
    const toolsResponse = await client.listTools()

    // Convert to ToolDefinition format
    const tools: ToolDefinition[] = toolsResponse.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as ToolDefinition['inputSchema'],
      // Add server name as metadata for tracking
      _meta: {
        server: serverName,
      },
    }))

    return tools
  }
  finally {
    try {
      await client.close()
    }
    catch {
      // Ignore close errors
    }
  }
}

/**
 * Discover tools from multiple MCP servers
 */
export async function discoverToolsFromServers(
  servers: MergedServerEntry[],
  options: DiscoverToolsOptions = {},
): Promise<ServerToolsResult[]> {
  const { timeout = 30000, onProgress, excludeServers = [] } = options
  const results: ServerToolsResult[] = []

  // Filter out excluded servers and self (pleaseai-mcp)
  const serversToQuery = servers.filter(
    s => !excludeServers.includes(s.name) && s.name !== 'pleaseai-mcp',
  )

  for (const server of serversToQuery) {
    const result: ServerToolsResult = {
      serverName: server.name,
      source: server.source,
      tools: [],
    }

    try {
      onProgress?.(server.name, 'connecting')

      const tools = await listToolsFromServer(server.name, server.config, timeout)
      result.tools = tools

      onProgress?.(server.name, 'done')
    }
    catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      onProgress?.(server.name, 'error')
    }

    results.push(result)
  }

  return results
}

/**
 * Flatten all tools from multiple server results
 */
export function flattenServerTools(results: ServerToolsResult[]): ToolDefinition[] {
  const allTools: ToolDefinition[] = []

  for (const result of results) {
    if (!result.error) {
      allTools.push(...result.tools)
    }
  }

  return allTools
}
