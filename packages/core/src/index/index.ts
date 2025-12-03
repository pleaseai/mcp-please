import type { EmbeddingProvider } from '../embedding/provider.js'
import type { IndexedTool } from '../types/index.js'
import type { PersistedIndex } from './storage.js'
import { IndexBuilder } from './builder.js'
import { ToolLoader } from './loader.js'
import { IndexStorage } from './storage.js'

export { IndexBuilder } from './builder.js'
export { ToolLoader } from './loader.js'
export { type BM25Stats, IndexStorage, type PersistedIndex } from './storage.js'

/**
 * Index manager options
 */
export interface IndexManagerOptions {
  embeddingProvider?: EmbeddingProvider
}

/**
 * Manages tool indexing operations
 */
export class IndexManager {
  private loader: ToolLoader
  private builder: IndexBuilder
  private storage: IndexStorage
  private embeddingProvider?: EmbeddingProvider

  private cachedIndex?: PersistedIndex
  private cachedIndexPath?: string

  constructor(options?: IndexManagerOptions) {
    this.loader = new ToolLoader()
    this.builder = new IndexBuilder()
    this.storage = new IndexStorage()
    this.embeddingProvider = options?.embeddingProvider
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider
  }

  /**
   * Get embedding provider
   */
  getEmbeddingProvider(): EmbeddingProvider | undefined {
    return this.embeddingProvider
  }

  /**
   * Build index from tool sources
   */
  async buildIndex(
    sources: string[],
    options?: {
      generateEmbeddings?: boolean
      onProgress?: (current: number, total: number, toolName: string) => void
    },
  ): Promise<IndexedTool[]> {
    // Load tools from sources
    const tools = await this.loader.loadFromSources(sources)

    // Build basic index
    const indexedTools = this.builder.buildIndex(tools)

    // Generate embeddings if requested
    if (options?.generateEmbeddings && this.embeddingProvider) {
      await this.generateEmbeddings(indexedTools, options.onProgress)
    }

    return indexedTools
  }

  /**
   * Generate embeddings for indexed tools
   */
  private async generateEmbeddings(
    indexedTools: IndexedTool[],
    onProgress?: (current: number, total: number, toolName: string) => void,
  ): Promise<void> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not configured')
    }

    // Batch embed for efficiency
    const batchSize = 32
    const total = indexedTools.length

    for (let i = 0; i < total; i += batchSize) {
      const batch = indexedTools.slice(i, i + batchSize)
      const texts = batch.map(t => t.searchableText)
      const embeddings = await this.embeddingProvider.embedBatch(texts)

      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = embeddings[j]

        if (onProgress) {
          onProgress(i + j + 1, total, batch[j].tool.name)
        }
      }
    }
  }

  /**
   * Save index to file
   */
  async saveIndex(indexedTools: IndexedTool[], outputPath: string): Promise<void> {
    const options = this.embeddingProvider
      ? {
          embeddingModel: this.embeddingProvider.name,
          embeddingDimensions: this.embeddingProvider.dimensions,
        }
      : undefined

    await this.storage.save(indexedTools, outputPath, options)

    // Invalidate cache if same path
    if (this.cachedIndexPath === outputPath) {
      this.cachedIndex = undefined
      this.cachedIndexPath = undefined
    }
  }

  /**
   * Load index from file with caching
   */
  async loadIndex(indexPath: string): Promise<PersistedIndex> {
    if (this.cachedIndexPath === indexPath && this.cachedIndex) {
      return this.cachedIndex
    }

    const index = await this.storage.load(indexPath)
    this.cachedIndex = index
    this.cachedIndexPath = indexPath

    return index
  }

  /**
   * Get indexed tools from file
   */
  async getIndexedTools(indexPath: string): Promise<IndexedTool[]> {
    const index = await this.loadIndex(indexPath)
    return index.tools
  }

  /**
   * Check if index exists
   */
  async indexExists(indexPath: string): Promise<boolean> {
    return this.storage.exists(indexPath)
  }

  /**
   * Get index metadata
   */
  async getIndexMetadata(indexPath: string): Promise<Omit<PersistedIndex, 'tools' | 'bm25Stats'>> {
    return this.storage.getMetadata(indexPath)
  }

  /**
   * Clear cached index
   */
  clearCache(): void {
    this.cachedIndex = undefined
    this.cachedIndexPath = undefined
  }
}
