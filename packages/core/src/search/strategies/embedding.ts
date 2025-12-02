import type { EmbeddingProvider } from '../../embedding/provider.js'
import type { IndexedTool, SearchMode, SearchOptions, ToolReference } from '../../types/index.js'
import type { SearchStrategy } from '../strategy.js'

/**
 * Embedding-based semantic search strategy
 * Uses vector similarity for semantic matching
 */
export class EmbeddingSearchStrategy implements SearchStrategy {
  readonly mode: SearchMode = 'embedding'

  private embeddingProvider?: EmbeddingProvider
  private initialized = false

  constructor(embeddingProvider?: EmbeddingProvider) {
    this.embeddingProvider = embeddingProvider
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider
    this.initialized = false
  }

  async initialize(): Promise<void> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not configured')
    }

    if (!this.initialized) {
      await this.embeddingProvider.initialize()
      this.initialized = true
    }
  }

  async search(query: string, indexedTools: IndexedTool[], options: SearchOptions): Promise<ToolReference[]> {
    if (!this.embeddingProvider) {
      throw new Error('Embedding provider not configured')
    }

    if (!this.initialized) {
      await this.initialize()
    }

    // Filter tools that have embeddings
    const toolsWithEmbeddings = indexedTools.filter(t => t.embedding && t.embedding.length > 0)

    if (toolsWithEmbeddings.length === 0) {
      throw new Error('No tools with embeddings found in index. Re-index with embeddings enabled.')
    }

    // Generate query embedding
    const queryEmbedding = await this.embeddingProvider.embed(query)

    // Calculate similarities
    const results: ToolReference[] = []

    for (const indexed of toolsWithEmbeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, indexed.embedding!)

      // Convert similarity to 0-1 score (cosine similarity ranges from -1 to 1)
      const score = (similarity + 1) / 2

      if (score >= (options.threshold ?? 0)) {
        results.push({
          name: indexed.tool.name,
          title: indexed.tool.title,
          description: indexed.tool.description,
          score: Math.round(score * 1000) / 1000,
          matchType: 'embedding',
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, options.topK)
  }

  async dispose(): Promise<void> {
    if (this.embeddingProvider) {
      await this.embeddingProvider.dispose()
      this.initialized = false
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    normA = Math.sqrt(normA)
    normB = Math.sqrt(normB)

    if (normA === 0 || normB === 0) {
      return 0
    }

    return dotProduct / (normA * normB)
  }
}
