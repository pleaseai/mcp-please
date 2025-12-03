import type { EmbeddingProvider, PersistedIndex, SearchMode, ServerConfig } from '@pleaseai/mcp-core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { z } from 'zod'
import { callToolOnMcpServer } from './utils/mcp-client.js'
import { getAllMcpServers } from './utils/mcp-config-loader.js'
import { OAuthManager, TokenStorage } from './utils/oauth/index.js'

/**
 * MCP Tool Search Server
 * Exposes tool search and discovery capabilities via MCP protocol
 *
 * Available tools:
 * - search_tools: Search for tools using regex, BM25, or semantic search
 * - list_tools: List all tools in the index with pagination
 * - get_tool: Get detailed tool information including schemas
 * - call_tool: Execute a tool (requires MCP client integration)
 * - tool_search_info: Get index metadata
 */
export class McpToolSearchServer {
  private server: McpServer
  private config: ServerConfig
  private indexManager: IndexManager
  private searchOrchestrator: SearchOrchestrator
  private embeddingProvider?: EmbeddingProvider
  private cachedIndex?: PersistedIndex

  constructor(config: ServerConfig) {
    this.config = config
    this.indexManager = new IndexManager()
    this.searchOrchestrator = new SearchOrchestrator({
      defaultMode: config.defaultMode,
      defaultTopK: 10,
    })

    this.server = new McpServer({
      name: 'pleaseai-mcp',
      version: '1.0.0',
    })

    this.registerTools()
  }

  /**
   * Set embedding provider for semantic search
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider
    this.searchOrchestrator.setEmbeddingProvider(provider)
    this.indexManager.setEmbeddingProvider(provider)
  }

  /**
   * Register MCP tools
   */
  private registerTools(): void {
    // Search tools
    this.server.registerTool(
      'search_tools',
      {
        title: 'Search Tools',
        description: `Search for tools using regex, BM25, or semantic search. Returns matching tools ranked by relevance.

This is typically the first step in the tool discovery workflow. After finding tools, use 'get_tool' to retrieve full schema details before calling.

Selection Process:
1. Enter a natural language query describing the tool you need
2. Results are ranked by relevance score
3. Select the most appropriate tool based on name and description match

Response Format:
- tools: Array of matching tools with name, description, and relevance score
- total: Total number of indexed tools available
- searchTimeMs: Search execution time in milliseconds`,
        inputSchema: {
          query: z.string().describe('Search query string'),
          mode: z
            .enum(['regex', 'bm25', 'embedding'])
            .optional()
            .default('bm25')
            .describe('Search algorithm: regex (pattern matching), bm25 (term frequency), embedding (semantic)'),
          top_k: z.number().optional().default(10).describe('Maximum number of results to return'),
          threshold: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .default(0)
            .describe('Minimum similarity score threshold (0-1)'),
        },
      },
      async ({ query, mode, top_k, threshold }) => {
        try {
          // Load index if not cached
          if (!this.cachedIndex) {
            this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
            this.searchOrchestrator.setBM25Stats(this.cachedIndex.bm25Stats)
          }

          // Initialize embedding provider for semantic search
          if (mode === 'embedding' && this.embeddingProvider) {
            await this.embeddingProvider.initialize()
          }

          // Perform search
          const result = await this.searchOrchestrator.search(
            {
              query,
              mode: mode as SearchMode,
              topK: top_k,
              threshold: threshold > 0 ? threshold : undefined,
            },
            this.cachedIndex.tools,
          )

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    tools: result.tools,
                    total: result.totalIndexed,
                    searchTimeMs: result.searchTimeMs,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
            isError: true,
          }
        }
      },
    )

    // Index info tool
    this.server.registerTool(
      'tool_search_info',
      {
        title: 'Tool Search Info',
        description: 'Get information about the tool search index',
        inputSchema: {},
      },
      async () => {
        try {
          const metadata = await this.indexManager.getIndexMetadata(this.config.indexPath)

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    indexPath: this.config.indexPath,
                    ...metadata,
                    availableModes: ['regex', 'bm25', ...(metadata.hasEmbeddings ? ['embedding'] : [])],
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
            isError: true,
          }
        }
      },
    )

    // List tools
    this.server.registerTool(
      'list_tools',
      {
        title: 'List Tools',
        description: 'List all tools in the index with pagination support',
        inputSchema: {
          limit: z.number().optional().default(100).describe('Maximum number of tools to return'),
          offset: z.number().optional().default(0).describe('Offset for pagination'),
        },
      },
      async ({ limit, offset }) => {
        try {
          if (!this.cachedIndex) {
            this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
          }

          const tools = this.cachedIndex.tools.slice(offset, offset + limit).map(t => ({
            name: t.tool.name,
            title: t.tool.title,
            description: t.tool.description,
          }))

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    tools,
                    total: this.cachedIndex.tools.length,
                    limit,
                    offset,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
            isError: true,
          }
        }
      },
    )

    // Get tool details
    this.server.registerTool(
      'get_tool',
      {
        title: 'Get Tool',
        description: `Get detailed information about a specific tool including its input schema, output schema, and metadata.

You MUST call this function before 'call_tool' to understand the required parameters. The inputSchema contains all required and optional fields with their types and descriptions.

Workflow: search_tools → get_tool → call_tool

Response Format:
- name: Full tool name (format: server__toolName)
- description: What the tool does
- requiredFields: Array of parameter names that MUST be provided
- parameters: Array of all parameters with name, type, required flag, and description
- inputSchema: Complete JSON Schema for validation
- metadata: Server name and original tool name for reference`,
        inputSchema: {
          name: z.string().describe('The name of the tool to retrieve (from search_tools results)'),
        },
      },
      async ({ name }) => {
        try {
          if (!this.cachedIndex) {
            this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
          }

          const indexedTool = this.cachedIndex.tools.find(t => t.tool.name === name)

          if (!indexedTool) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: `Tool '${name}' not found` }),
                },
              ],
              isError: true,
            }
          }

          const { tool } = indexedTool

          // Extract required fields from inputSchema
          const requiredFields = tool.inputSchema.required || []
          const properties = tool.inputSchema.properties || {}

          // Build parameter summary for easy reference
          const parameters = Object.entries(properties).map(([key, schema]) => ({
            name: key,
            type: (schema as { type?: string }).type || 'unknown',
            required: requiredFields.includes(key),
            description: (schema as { description?: string }).description || '',
          }))

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                    requiredFields,
                    parameters,
                    inputSchema: tool.inputSchema,
                    outputSchema: tool.outputSchema,
                    metadata: tool.metadata,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
            isError: true,
          }
        }
      },
    )

    // Call tool - executes a tool on its source MCP server
    this.server.registerTool(
      'call_tool',
      {
        title: 'Call Tool',
        description: `Execute a tool with the provided arguments. Connects to the source MCP server and returns the execution result.

You MUST call 'get_tool' first to obtain the exact input schema required to use this tool. The inputSchema from get_tool contains all required fields - missing required fields will cause errors.

Workflow: search_tools → get_tool → call_tool

Response Format:
- On success: Returns the tool's output content (text, data, or binary)
- On error: Returns error message with details about what went wrong

Common Errors:
- Missing required fields: Check get_tool response for requiredFields
- Server not configured: The MCP server for this tool is not in your configuration
- Authentication required: OAuth session expired or not configured`,
        inputSchema: {
          name: z.string().describe('The name of the tool to execute (from search_tools or get_tool)'),
          arguments: z.record(z.string(), z.unknown()).optional().default({}).describe('Arguments matching the inputSchema from get_tool. Include ALL required fields.'),
        },
      },
      async ({ name, arguments: args }) => {
        try {
          if (!this.cachedIndex) {
            this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
          }

          const indexedTool = this.cachedIndex.tools.find(t => t.tool.name === name)

          if (!indexedTool) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: `Tool '${name}' not found` }),
                },
              ],
              isError: true,
            }
          }

          // Get server name and original tool name from metadata
          const serverName = indexedTool.tool.metadata?.server as string | undefined
          const originalName = indexedTool.tool.metadata?.originalName as string | undefined

          if (!serverName || !originalName) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'Tool metadata missing',
                    hint: 'Tool does not have server information. Re-index from MCP servers.',
                  }),
                },
              ],
              isError: true,
            }
          }

          // Get server config
          const allServers = getAllMcpServers()
          const serverConfig = allServers.get(serverName)

          if (!serverConfig) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: `Server '${serverName}' not found in configuration`,
                    hint: 'The MCP server for this tool is not configured.',
                  }),
                },
              ],
              isError: true,
            }
          }

          // Get access token for OAuth servers
          let accessToken: string | undefined

          if (serverConfig.authorization?.type === 'oauth2' && serverConfig.url) {
            const tokenStorage = new TokenStorage()
            const hasSession = await tokenStorage.hasSession(serverConfig.url)

            if (hasSession) {
              const oauthManager = new OAuthManager({
                serverName,
                serverUrl: serverConfig.url,
                scopes: serverConfig.authorization.oauth?.scopes,
              })
              accessToken = await oauthManager.getAccessToken()
            }
            else {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: `No valid OAuth session for '${serverName}'`,
                      hint: `Run: mcp-search mcp auth ${serverName}`,
                    }),
                  },
                ],
                isError: true,
              }
            }
          }
          else if (serverConfig.authorization?.type === 'bearer') {
            accessToken = serverConfig.authorization.token
          }

          // Call the tool on the MCP server
          const result = await callToolOnMcpServer({
            name: serverName,
            config: serverConfig,
            accessToken,
            toolName: originalName,
            arguments: args as Record<string, unknown>,
          })

          return {
            content: result.content.map(c => ({
              type: c.type as 'text',
              text: c.text ?? (c.data ? `[Binary data: ${c.mimeType}]` : ''),
            })),
            isError: result.isError,
          }
        }
        catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: message }),
              },
            ],
            isError: true,
          }
        }
      },
    )
  }

  /**
   * Start the server
   */
  async start(transport: 'stdio' | 'http' = 'stdio'): Promise<void> {
    // Initialize embedding provider if configured
    if (this.config.embeddingProvider) {
      this.embeddingProvider = createEmbeddingProvider(this.config.embeddingProvider)
      this.searchOrchestrator.setEmbeddingProvider(this.embeddingProvider)
    }

    // Pre-load index
    try {
      this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
      this.searchOrchestrator.setBM25Stats(this.cachedIndex.bm25Stats)
    }
    catch {
      // Index will be loaded on first request
    }

    if (transport === 'stdio') {
      const stdioTransport = new StdioServerTransport()
      await this.server.connect(stdioTransport)
    }
    else {
      // HTTP transport not implemented in this version
      throw new Error('HTTP transport not yet implemented')
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.searchOrchestrator.dispose()
    await this.server.close()
  }
}
