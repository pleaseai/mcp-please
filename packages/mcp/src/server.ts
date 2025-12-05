import type { ServerConfig as BaseServerConfig, EmbeddingProvider, PersistedIndex, SearchMode } from '@pleaseai/mcp-core'
import type { ToolExecutor } from './services/tool-executor.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { z } from 'zod'
import { createToolExecutor } from './services/tool-executor.js'
import { generateCliUsage } from './utils/cli-usage.js'
import { mergeBM25Stats, mergeIndexedTools } from './utils/tool-deduplication.js'

/**
 * Extended server config with multi-index support
 */
interface ServerConfig extends BaseServerConfig {
  /** Multiple index paths for scope 'all' mode */
  indexPaths?: string[]
}

/**
 * MCP Tool Search Server
 * Exposes tool search and discovery capabilities via MCP protocol
 *
 * Available tools:
 * - search_tools: Search for tools using regex, BM25, or semantic search
 * - list_tools: List all tools in the index with pagination
 * - get_tool: Get detailed tool information including schemas and CLI usage
 * - tool_search_info: Get index metadata
 */
export class McpToolSearchServer {
  private server: McpServer
  private config: ServerConfig
  private indexManager: IndexManager
  private searchOrchestrator: SearchOrchestrator
  private embeddingProvider?: EmbeddingProvider
  private cachedIndex?: PersistedIndex
  private toolExecutor: ToolExecutor

  constructor(config: ServerConfig) {
    this.config = config
    this.indexManager = new IndexManager()
    this.searchOrchestrator = new SearchOrchestrator({
      defaultMode: config.defaultMode,
      defaultTopK: 10,
    })

    // Create tool executor with lazy index loading
    this.toolExecutor = createToolExecutor({
      getIndex: async () => {
        if (!this.cachedIndex) {
          this.cachedIndex = await this.loadMergedIndex()
        }
        return this.cachedIndex
      },
    })

    this.server = new McpServer({
      name: 'mcp-gateway',
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
   * Load and optionally merge indexes from multiple paths
   */
  private async loadMergedIndex(): Promise<PersistedIndex> {
    // If multiple index paths specified, load and merge
    if (this.config.indexPaths && this.config.indexPaths.length > 1) {
      const [projectPath, userPath] = this.config.indexPaths

      let projectIndex: PersistedIndex | null = null
      let userIndex: PersistedIndex | null = null

      try {
        projectIndex = await this.indexManager.loadIndex(projectPath)
      }
      catch {
        // Project index doesn't exist
      }

      try {
        userIndex = await this.indexManager.loadIndex(userPath)
      }
      catch {
        // User index doesn't exist
      }

      if (!projectIndex && !userIndex) {
        throw new Error('No indexes found')
      }

      // Merge tools with project taking priority
      const mergedTools = mergeIndexedTools(projectIndex, userIndex)
      const mergedBm25Stats = mergeBM25Stats(projectIndex, userIndex)
      const hasEmbeddings = (projectIndex?.hasEmbeddings ?? false) || (userIndex?.hasEmbeddings ?? false)

      // Return synthetic merged index
      return {
        version: projectIndex?.version ?? userIndex?.version ?? '1.0.0',
        createdAt: projectIndex?.createdAt ?? userIndex?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTools: mergedTools.length,
        hasEmbeddings,
        embeddingModel: projectIndex?.embeddingModel ?? userIndex?.embeddingModel,
        embeddingDimensions: projectIndex?.embeddingDimensions ?? userIndex?.embeddingDimensions,
        bm25Stats: mergedBm25Stats,
        tools: mergedTools,
      }
    }

    // Single index path (backward compatible)
    return this.indexManager.loadIndex(this.config.indexPath)
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
            .enum(['regex', 'bm25', 'embedding', 'hybrid'])
            .optional()
            .default('bm25')
            .describe('Search algorithm: regex (pattern matching), bm25 (term frequency), embedding (semantic), hybrid (bm25 + embedding with RRF)'),
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

          // Initialize embedding provider for semantic search (embedding and hybrid modes)
          if ((mode === 'embedding' || mode === 'hybrid') && this.embeddingProvider) {
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
                    availableModes: ['regex', 'bm25', ...(metadata.hasEmbeddings ? ['embedding', 'hybrid'] : [])],
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

You MUST call this function before calling a tool to understand the required parameters. The inputSchema contains all required and optional fields with their types and descriptions.

Workflow: search_tools → get_tool → (use cliUsage via Bash)

Response Format:
- name: Full tool name (format: server__toolName)
- description: What the tool does
- requiredFields: Array of parameter names that MUST be provided
- parameters: Array of all parameters with name, type, required flag, and description
- inputSchema: Complete JSON Schema for validation
- metadata: Server name and original tool name for reference
- cliUsage: CLI command template for executing via Bash tool (enables permission checks)

RECOMMENDED: Use the cliUsage command via Bash tool instead of call_tool for better permission handling and error messages.`,
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

          // Generate CLI usage template for permission-checkable tool calls
          const cliUsage = generateCliUsage(tool)

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
                    cliUsage,
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

    // Pre-load index (potentially merged from multiple scopes)
    try {
      this.cachedIndex = await this.loadMergedIndex()
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
