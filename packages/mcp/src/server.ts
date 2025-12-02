import type { EmbeddingProvider, PersistedIndex, SearchMode, ServerConfig } from '@pleaseai/mcp-core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { z } from 'zod'

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
    // Tool search tool
    this.server.registerTool(
      'tool_search',
      {
        title: 'Tool Search',
        description: 'Search for tools using regex, BM25, or semantic search. Returns matching tools ranked by relevance.',
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

    // List tools tool
    this.server.registerTool(
      'tool_search_list',
      {
        title: 'Tool Search List',
        description: 'List all tools in the index',
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
