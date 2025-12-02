import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { EmbeddingProvider, PersistedIndex, SearchMode, ServerConfig } from '@pleaseai/mcp-core'
import type { MergedServerEntry } from './utils/mcp-config.js'
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { encode as toToon } from '@toon-format/toon'
import { z } from 'zod/v3'
import { loadAllMcpServers } from './utils/mcp-config.js'
import { ToolExecutor } from './utils/tool-executor.js'

const require = createRequire(import.meta.url)
const { name, version } = require('../package.json') as { name: string, version: string }

// ============================================================================
// Tool: search_tools
// ============================================================================

const SearchToolsInputSchema = {
  query: z.string().describe('Search query string (e.g., "file operations", "database", "read.*")'),
  mode: z
    .enum(['regex', 'bm25', 'embedding'])
    .optional()
    .default('bm25')
    .describe('Search algorithm: regex (pattern matching), bm25 (term frequency - default, best for keywords), embedding (semantic - best for natural language)'),
  top_k: z.number().optional().default(10).describe('Maximum number of results to return'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0)
    .describe('Minimum similarity score threshold (0-1)'),
}

interface SearchToolsInput {
  query: string
  mode: 'regex' | 'bm25' | 'embedding'
  top_k: number
  threshold: number
}

const SEARCH_TOOLS_DESCRIPTION = `Search for tools using regex, BM25, or semantic search. Returns matching tools ranked by relevance.

When to use:
- Finding the right tool for a specific task
- Discovering available tools by functionality
- Looking up tools by name pattern

Examples:
- query: "file operations" → finds tools for reading, writing, editing files
- query: "read.*" with mode: "regex" → finds tools matching the pattern
- query: "tools for sending messages" with mode: "embedding" → semantic search`

// ============================================================================
// Tool: get_index_info
// ============================================================================

const GetIndexInfoInputSchema = {}

const GET_INDEX_INFO_DESCRIPTION = `Get information about the tool search index.

Returns: total tool count, available search modes, embedding status, and index metadata.

When to use:
- Check if embedding search is available
- Get total number of indexed tools
- Verify index is loaded correctly`

// ============================================================================
// Tool: list_tools
// ============================================================================

const ListToolsInputSchema = {
  limit: z.number().optional().default(100).describe('Maximum number of tools to return (default: 100)'),
  offset: z.number().optional().default(0).describe('Starting position for pagination (default: 0)'),
}

interface ListToolsInput {
  limit: number
  offset: number
}

const LIST_TOOLS_DESCRIPTION = `List all tools in the index with pagination.

Returns: array of tools with name, title, and description.

When to use:
- Browse all available tools without searching
- Get a complete inventory of indexed tools
- Paginate through large tool collections`

// ============================================================================
// Tool: call_tool
// ============================================================================

const CallToolInputSchema = {
  tool_name: z.string().describe('Name of the tool to execute'),
  server_name: z.string().optional().describe('Name of the MCP server (optional - auto-detected from index if not provided)'),
  arguments: z.record(z.unknown()).optional().default({}).describe('Arguments to pass to the tool'),
}

interface CallToolInput {
  tool_name: string
  server_name?: string
  arguments: Record<string, unknown>
}

const CALL_TOOL_DESCRIPTION = `Execute a tool on an MCP server.

Returns: Tool execution result from the target MCP server.

When to use:
- Execute a tool after finding it with search_tools
- Call tools on registered MCP servers
- Interact with external MCP server capabilities

Notes:
- If server_name is not provided, it will be auto-detected from the tool's metadata in the index
- The tool must exist in the index and have a valid server reference
- Arguments must match the tool's input schema`

// ============================================================================
// Tool: get_tool
// ============================================================================

const GetToolInputSchema = {
  tool_name: z.string().describe('Name of the tool to retrieve details for'),
}

interface GetToolInput {
  tool_name: string
}

const GET_TOOL_DESCRIPTION = `Get detailed information about a specific tool including its input/output schema.

Returns: Full tool definition with name, description, inputSchema, outputSchema, and server metadata.

When to use:
- After search_tools to get parameter schema before call_tool
- To understand required/optional parameters
- To validate arguments before execution`

// ============================================================================
// Helper functions
// ============================================================================

function createTextResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: toToon(data, {
          indent: 2,
          delimiter: '\t',
          keyFolding: 'safe',
        }),
      },
    ],
  }
}

function createErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
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

/**
 * MCP Tool Search Server
 * Exposes tool_search capability via MCP protocol
 */
export class McpToolSearchServer {
  private server!: McpServer
  private config: ServerConfig
  private indexManager: IndexManager
  private searchOrchestrator: SearchOrchestrator
  private embeddingProvider?: EmbeddingProvider
  private cachedIndex?: PersistedIndex
  private toolExecutor: ToolExecutor
  private serverConfigs: MergedServerEntry[] = []

  constructor(config: ServerConfig) {
    this.config = config
    this.indexManager = new IndexManager()
    this.searchOrchestrator = new SearchOrchestrator({
      defaultMode: config.defaultMode,
      defaultTopK: 10,
    })
    this.toolExecutor = new ToolExecutor()
  }

  /**
   * Generate indexed tools summary for server instructions
   */
  private generateIndexedToolsSummary(): string {
    if (!this.cachedIndex || this.cachedIndex.tools.length === 0) {
      return ''
    }

    // Group tools by server
    const toolsByServer = this.cachedIndex.tools.reduce((acc, t) => {
      const server = (t.tool._meta?.server as string) || 'unknown'
      if (!acc[server]) {
        acc[server] = []
      }
      acc[server].push(t.tool.name)
      return acc
    }, {} as Record<string, string[]>)

    // Format summary
    const summary = Object.entries(toolsByServer)
      .map(([server, tools]) => {
        const displayTools = tools.slice(0, 5).join(', ')
        const moreCount = tools.length > 5 ? ` (+${tools.length - 5} more)` : ''
        return `  - ${server}: ${displayTools}${moreCount}`
      })
      .join('\n')

    return `\n\nIndexed MCP tools (use search_tools to find, call_tool to execute):\n${summary}`
  }

  /**
   * Initialize the MCP server with dynamic instructions
   */
  private initializeServer(): void {
    const indexedToolsSummary = this.generateIndexedToolsSummary()

    this.server = new McpServer({
      name,
      version,
    }, {
      instructions: `Use this server to search for and execute tools indexed from MCP servers.
Available tools:
- search_tools: Search tools by query with regex, BM25, or embedding modes
- list_tools: List all indexed tools with pagination
- get_index_info: Get index metadata and available search modes
- get_tool: Get detailed tool information including input/output schema
- call_tool: Execute a tool on an MCP server${indexedToolsSummary}`,
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
    this.registerSearchTools()
    this.registerGetIndexInfo()
    this.registerListTools()
    this.registerGetTool()
    this.registerCallTool()
  }

  /**
   * Register search_tools tool
   */
  private registerSearchTools(): void {
    const handleSearchTools = async (input: SearchToolsInput): Promise<CallToolResult> => {
      try {
        // Load index if not cached
        if (!this.cachedIndex) {
          this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
          this.searchOrchestrator.setBM25Stats(this.cachedIndex.bm25Stats)
        }

        // Initialize embedding provider for semantic search
        if (input.mode === 'embedding' && this.embeddingProvider) {
          await this.embeddingProvider.initialize()
        }

        // Perform search
        const result = await this.searchOrchestrator.search(
          {
            query: input.query,
            mode: input.mode as SearchMode,
            topK: input.top_k,
            threshold: input.threshold > 0 ? input.threshold : undefined,
          },
          this.cachedIndex.tools,
        )

        return createTextResult({
          tools: result.tools,
          total: result.totalIndexed,
          searchTimeMs: result.searchTimeMs,
        })
      }
      catch (err) {
        return createErrorResult(err)
      }
    }

    // @ts-expect-error - zod type instantiation is excessively deep with MCP SDK
    this.server.registerTool(
      'search_tools',
      {
        title: 'Search Tools',
        description: SEARCH_TOOLS_DESCRIPTION,
        inputSchema: SearchToolsInputSchema,
      },
      handleSearchTools,
    )
  }

  /**
   * Register get_index_info tool
   */
  private registerGetIndexInfo(): void {
    const handleGetIndexInfo = async (): Promise<CallToolResult> => {
      try {
        const metadata = await this.indexManager.getIndexMetadata(this.config.indexPath)

        return createTextResult({
          indexPath: this.config.indexPath,
          ...metadata,
          availableModes: ['regex', 'bm25', ...(metadata.hasEmbeddings ? ['embedding'] : [])],
        })
      }
      catch (err) {
        return createErrorResult(err)
      }
    }

    this.server.registerTool(
      'get_index_info',
      {
        title: 'Get Index Info',
        description: GET_INDEX_INFO_DESCRIPTION,
        inputSchema: GetIndexInfoInputSchema,
      },
      handleGetIndexInfo,
    )
  }

  /**
   * Register list_tools tool
   */
  private registerListTools(): void {
    const handleListTools = async (input: ListToolsInput): Promise<CallToolResult> => {
      try {
        if (!this.cachedIndex) {
          this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
        }

        const tools = this.cachedIndex.tools.slice(input.offset, input.offset + input.limit).map(t => ({
          name: t.tool.name,
          title: t.tool.title,
          description: t.tool.description,
        }))

        return createTextResult({
          tools,
          total: this.cachedIndex.tools.length,
          limit: input.limit,
          offset: input.offset,
        })
      }
      catch (err) {
        return createErrorResult(err)
      }
    }

    this.server.registerTool(
      'list_tools',
      {
        title: 'List Tools',
        description: LIST_TOOLS_DESCRIPTION,
        inputSchema: ListToolsInputSchema,
      },
      handleListTools,
    )
  }

  /**
   * Register get_tool tool
   */
  private registerGetTool(): void {
    const handleGetTool = async (input: GetToolInput): Promise<CallToolResult> => {
      try {
        if (!this.cachedIndex) {
          this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
        }

        const indexedTool = this.cachedIndex.tools.find(t => t.tool.name === input.tool_name)
        if (!indexedTool) {
          return createErrorResult(`Tool not found: ${input.tool_name}`)
        }

        const tool = indexedTool.tool
        return createTextResult({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          metadata: tool.metadata,
          server: tool._meta?.server,
        })
      }
      catch (err) {
        return createErrorResult(err)
      }
    }

    this.server.registerTool(
      'get_tool',
      {
        title: 'Get Tool',
        description: GET_TOOL_DESCRIPTION,
        inputSchema: GetToolInputSchema,
      },
      handleGetTool,
    )
  }

  /**
   * Register call_tool tool
   */
  private registerCallTool(): void {
    const handleCallTool = async (input: CallToolInput): Promise<CallToolResult> => {
      try {
        // Load index if not cached
        if (!this.cachedIndex) {
          this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
        }

        // Find the tool in the index
        const indexedTool = this.cachedIndex.tools.find(t => t.tool.name === input.tool_name)
        if (!indexedTool) {
          return createErrorResult(`Tool not found: ${input.tool_name}`)
        }

        // Determine server name
        let serverName = input.server_name
        if (!serverName) {
          // Try to get from tool metadata
          serverName = indexedTool.tool._meta?.server as string | undefined
          if (!serverName) {
            return createErrorResult(
              `Server name not provided and tool "${input.tool_name}" has no server metadata. `
              + `Please provide server_name parameter.`,
            )
          }
        }

        // Check if server is registered
        if (!this.toolExecutor.hasServer(serverName)) {
          return createErrorResult(
            `Server "${serverName}" is not registered. `
            + `Available servers: ${this.toolExecutor.getRegisteredServers().join(', ') || 'none'}`,
          )
        }

        // Execute the tool
        const result = await this.toolExecutor.callTool(serverName, input.tool_name, input.arguments)

        if (!result.success) {
          return createErrorResult(result.error || 'Unknown error')
        }

        // Convert compatibility result to CallToolResult
        const toolResult = result.result!

        // Handle both old (toolResult) and new (content) formats
        if ('content' in toolResult && Array.isArray(toolResult.content)) {
          return {
            content: toolResult.content as CallToolResult['content'],
            isError: toolResult.isError as boolean | undefined,
          }
        }
        else if ('toolResult' in toolResult) {
          // Legacy format - wrap in text content
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(toolResult.toolResult, null, 2),
              },
            ],
          }
        }

        // Fallback
        return createTextResult(toolResult)
      }
      catch (err) {
        return createErrorResult(err)
      }
    }

    // @ts-expect-error - zod type instantiation is excessively deep with MCP SDK
    this.server.registerTool(
      'call_tool',
      {
        title: 'Call Tool',
        description: CALL_TOOL_DESCRIPTION,
        inputSchema: CallToolInputSchema,
      },
      handleCallTool,
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

    // Load MCP server configurations for tool execution
    this.serverConfigs = loadAllMcpServers()
    this.toolExecutor.registerServers(this.serverConfigs)

    // Pre-load index (before server initialization for dynamic instructions)
    try {
      this.cachedIndex = await this.indexManager.loadIndex(this.config.indexPath)
      this.searchOrchestrator.setBM25Stats(this.cachedIndex.bm25Stats)
    }
    catch {
      // Index will be loaded on first request
    }

    // Initialize server with dynamic instructions (includes indexed tools summary)
    this.initializeServer()

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
    await this.toolExecutor.dispose()
    await this.searchOrchestrator.dispose()
    await this.server.close()
  }
}
