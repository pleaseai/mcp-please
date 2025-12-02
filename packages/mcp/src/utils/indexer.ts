import type { EmbeddingProvider, EmbeddingProviderType, IndexedTool, ModelDtype, PersistedIndex } from '@pleaseai/mcp-core'
import type { MergedServerEntry } from './mcp-config.js'
import {
  createEmbeddingProvider,
  IndexBuilder,
  IndexManager,
} from '@pleaseai/mcp-core'
import { discoverToolsFromServers, flattenServerTools } from './mcp-client.js'
import { loadAllMcpServers } from './mcp-config.js'

/**
 * Options for the indexing process
 */
export interface IndexOptions {
  outputPath: string
  embeddingProvider?: EmbeddingProviderType
  embeddingModel?: string
  /** Model dtype for local providers (default: 'fp32') */
  dtype?: ModelDtype
  generateEmbeddings?: boolean
  timeout?: number
  excludeServers?: string[]
  force?: boolean
  onProgress?: (message: string) => void
  onServerProgress?: (serverName: string, status: 'connecting' | 'listing' | 'done' | 'error') => void
  onWarning?: (message: string) => void
  onInfo?: (message: string) => void
}

/**
 * Result of the indexing process
 */
export interface IndexResult {
  indexedTools: IndexedTool[]
  hasEmbeddings: boolean
  outputPath: string
}

/**
 * Build and save a search index from MCP servers
 *
 * This function extracts the core indexing logic for reuse in both
 * the index command and auto-indexing during server startup.
 */
export async function buildAndSaveIndex(options: IndexOptions): Promise<IndexResult> {
  const {
    outputPath,
    embeddingProvider: providerType,
    embeddingModel,
    dtype,
    generateEmbeddings = false,
    timeout = 30000,
    excludeServers = [],
    force = false,
    onProgress,
    onServerProgress,
    onWarning,
    onInfo,
  } = options

  const indexManager = new IndexManager()
  let embeddingProvider: EmbeddingProvider | undefined

  // Setup embedding provider if needed
  if (generateEmbeddings && providerType) {
    onProgress?.(`Initializing ${providerType} embedding provider...`)

    embeddingProvider = createEmbeddingProvider({
      type: providerType,
      model: embeddingModel,
      dtype,
    })

    await embeddingProvider.initialize()
    indexManager.setEmbeddingProvider(embeddingProvider)

    onInfo?.(`Using ${providerType} embeddings (${embeddingProvider.dimensions} dimensions)`)
  }

  // Check if index exists
  if (!force) {
    const exists = await indexManager.indexExists(outputPath)
    if (exists) {
      throw new Error(`Index already exists at ${outputPath}. Use force option to overwrite.`)
    }
  }

  // Auto-discover MCP servers
  onProgress?.('Loading MCP server configurations...')
  const servers: MergedServerEntry[] = loadAllMcpServers()

  if (servers.length === 0) {
    throw new Error('No MCP servers found. Create .please/mcp.json or provide config files.')
  }

  onInfo?.(`Found ${servers.length} MCP server(s)`)

  // Discover tools from servers
  onProgress?.('Discovering tools from MCP servers...')
  const results = await discoverToolsFromServers(servers, {
    timeout,
    excludeServers,
    onProgress: onServerProgress,
  })

  // Report results
  for (const result of results) {
    if (result.error) {
      onWarning?.(`${result.serverName} (${result.source}): ${result.error}`)
    }
    else {
      onInfo?.(`${result.serverName} (${result.source}): ${result.tools.length} tools`)
    }
  }

  const tools = flattenServerTools(results)

  if (tools.length === 0) {
    throw new Error('No tools found from MCP servers.')
  }

  // Build index
  onProgress?.('Building index...')
  const builder = new IndexBuilder()
  const builtIndex = builder.buildIndex(tools)

  // Generate embeddings if needed
  if (generateEmbeddings && embeddingProvider) {
    const batchSize = 32
    for (let i = 0; i < builtIndex.length; i += batchSize) {
      const batch = builtIndex.slice(i, i + batchSize)
      const texts = batch.map(t => t.searchableText)
      const embeddings = await embeddingProvider.embedBatch(texts)
      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = embeddings[j]
        onProgress?.(`Processing ${i + j + 1}/${builtIndex.length}: ${batch[j].tool.name}`)
      }
    }
  }

  // Save index
  onProgress?.('Saving index...')
  await indexManager.saveIndex(builtIndex, outputPath)

  const hasEmbeddings = builtIndex.some(t => t.embedding && t.embedding.length > 0)

  return {
    indexedTools: builtIndex,
    hasEmbeddings,
    outputPath,
  }
}

/**
 * Check if an index needs to be rebuilt
 *
 * Returns true if:
 * - Index doesn't exist
 * - Index is empty (no tools)
 */
export async function indexNeedsRebuild(indexPath: string): Promise<boolean> {
  const indexManager = new IndexManager()

  try {
    const exists = await indexManager.indexExists(indexPath)
    if (!exists) {
      return true
    }

    // Check if index has any tools
    const metadata = await indexManager.getIndexMetadata(indexPath)
    return metadata.totalTools === 0
  }
  catch {
    return true
  }
}

/**
 * Load an existing index or build a new one if needed
 */
export async function loadOrBuildIndex(options: IndexOptions): Promise<PersistedIndex> {
  const indexManager = new IndexManager()
  const needsRebuild = await indexNeedsRebuild(options.outputPath)

  if (needsRebuild) {
    await buildAndSaveIndex({ ...options, force: true })
  }

  return indexManager.loadIndex(options.outputPath)
}
