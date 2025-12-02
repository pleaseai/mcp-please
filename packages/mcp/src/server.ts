import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { EmbeddingProvider, PersistedIndex, SearchMode, ServerConfig } from '@pleaseai/mcp-core'
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { z } from 'zod/v3'

const require = createRequire(import.meta.url)
const { name, version } = require('../package.json') as { name: string, version: string }

// ============================================================================
// Tool: tool_search
// ============================================================================

const ToolSearchInputSchema = {
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

interface ToolSearchInput {
  query: string
  mode: 'regex' | 'bm25' | 'embedding'
  top_k: number
  threshold: number
}

const TOOL_SEARCH_DESCRIPTION = `Search for tools using regex, BM25, or semantic search. Returns matching tools ranked by relevance.

When to use:
- Finding the right tool for a specific task
- Discovering available tools by functionality
- Looking up tools by name pattern

Examples:
- query: "file operations" → finds tools for reading, writing, editing files
- query: "read.*" with mode: "regex" → finds tools matching the pattern
- query: "tools for sending messages" with mode: "embedding" → semantic search`

// ============================================================================
// Tool: tool_search_info
// ============================================================================

const ToolSearchInfoInputSchema = {}

const TOOL_SEARCH_INFO_DESCRIPTION = `Get information about the tool search index.

Returns: total tool count, available search modes, embedding status, and index metadata.

When to use:
- Check if embedding search is available
- Get total number of indexed tools
- Verify index is loaded correctly`

// ============================================================================
// Tool: tool_search_list
// ============================================================================

const ToolSearchListInputSchema = {
  limit: z.number().optional().default(100).describe('Maximum number of tools to return (default: 100)'),
  offset: z.number().optional().default(0).describe('Starting position for pagination (default: 0)'),
}

interface ToolSearchListInput {
  limit: number
  offset: number
}

const TOOL_SEARCH_LIST_DESCRIPTION = `List all tools in the index with pagination.

Returns: array of tools with name, title, and description.

When to use:
- Browse all available tools without searching
- Get a complete inventory of indexed tools
- Paginate through large tool collections`

// ============================================================================
// Helper functions
// ============================================================================

function createTextResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
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
      name,
      version,
    }, {
      instructions: `Use this server to search for tools indexed from MCP servers.
Available tools:
- tool_search: Search tools by query with regex, BM25, or embedding modes
- tool_search_info: Get index metadata and available search modes
- tool_search_list: List all indexed tools with pagination`,
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
    this.registerToolSearch()
    this.registerToolSearchInfo()
    this.registerToolSearchList()
  }

  /**
   * Register tool_search tool
   */
  private registerToolSearch(): void {
    const handleToolSearch = async (input: ToolSearchInput): Promise<CallToolResult> => {
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
      'tool_search',
      {
        title: 'Tool Search',
        description: TOOL_SEARCH_DESCRIPTION,
        inputSchema: ToolSearchInputSchema,
      },
      handleToolSearch,
    )
  }

  /**
   * Register tool_search_info tool
   */
  private registerToolSearchInfo(): void {
    const handleToolSearchInfo = async (): Promise<CallToolResult> => {
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
      'tool_search_info',
      {
        title: 'Tool Search Info',
        description: TOOL_SEARCH_INFO_DESCRIPTION,
        inputSchema: ToolSearchInfoInputSchema,
      },
      handleToolSearchInfo,
    )
  }

  /**
   * Register tool_search_list tool
   */
  private registerToolSearchList(): void {
    const handleToolSearchList = async (input: ToolSearchListInput): Promise<CallToolResult> => {
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
      'tool_search_list',
      {
        title: 'Tool Search List',
        description: TOOL_SEARCH_LIST_DESCRIPTION,
        inputSchema: ToolSearchListInputSchema,
      },
      handleToolSearchList,
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
