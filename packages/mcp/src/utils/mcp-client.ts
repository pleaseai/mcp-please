/**
 * MCP Client for connecting to MCP servers and fetching tools
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition } from '@pleaseai/mcp-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type TransportType = 'stdio' | 'http' | 'sse'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: TransportType
}

export interface McpClientOptions {
  name: string
  config: McpServerConfig
  accessToken?: string
}

/**
 * Connect to an MCP server and fetch its tools
 */
export async function fetchToolsFromMcpServer(options: McpClientOptions): Promise<ToolDefinition[]> {
  const { name, config, accessToken } = options

  const client = new Client(
    { name: `mcp-search-client-${name}`, version: '1.0.0' },
    { capabilities: {} },
  )

  try {
    const transport = await createTransport(config, accessToken)
    await client.connect(transport)

    const response = await client.listTools()
    const tools = response.tools.map(tool => convertMcpToolToDefinition(tool, name))

    await client.close()
    return tools
  }
  catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}

/**
 * Create appropriate transport based on config
 */
async function createTransport(
  config: McpServerConfig,
  accessToken?: string,
): Promise<StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport> {
  const transportType = config.transport ?? (config.url ? 'http' : 'stdio')

  // Prepare headers for HTTP/SSE transports
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (transportType === 'stdio') {
    if (!config.command) {
      throw new Error('Command required for stdio transport')
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    })
  }

  if (!config.url) {
    throw new Error('URL required for HTTP/SSE transport')
  }

  if (transportType === 'sse') {
    const sseOptions: { requestInit?: RequestInit } = {}
    if (Object.keys(headers).length > 0) {
      sseOptions.requestInit = { headers }
    }
    return new SSEClientTransport(new URL(config.url), sseOptions)
  }

  // HTTP transport
  const httpOptions: { requestInit?: { headers: Record<string, string> } } = {}
  if (Object.keys(headers).length > 0) {
    httpOptions.requestInit = { headers }
  }
  return new StreamableHTTPClientTransport(new URL(config.url), httpOptions)
}

/**
 * Convert MCP SDK Tool to our ToolDefinition format
 */
function convertMcpToolToDefinition(tool: Tool, serverName: string): ToolDefinition {
  return {
    name: `${serverName}__${tool.name}`,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as ToolDefinition['inputSchema'],
    metadata: {
      server: serverName,
      originalName: tool.name,
    },
  }
}

export interface CallToolOptions {
  name: string
  config: McpServerConfig
  accessToken?: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface CallToolResult {
  content: Array<{ type: string, text?: string, data?: string, mimeType?: string }>
  isError?: boolean
}

/**
 * Call a tool on an MCP server
 */
export async function callToolOnMcpServer(options: CallToolOptions): Promise<CallToolResult> {
  const { name, config, accessToken, toolName, arguments: args } = options

  const client = new Client(
    { name: `mcp-search-client-${name}`, version: '1.0.0' },
    { capabilities: {} },
  )

  try {
    const transport = await createTransport(config, accessToken)
    await client.connect(transport)

    const result = await client.callTool({ name: toolName, arguments: args })

    await client.close()

    return {
      content: result.content as CallToolResult['content'],
      isError: result.isError as boolean | undefined,
    }
  }
  catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}
