import type { EmbeddingProvider } from '../embedding/provider.js'
import type { BM25Stats } from '../index/storage.js'
import type { IndexedTool, SearchMode, SearchOptions, SearchQuery, SearchResult } from '../types/index.js'
import type { SearchStrategy } from './strategy.js'
import { BM25SearchStrategy } from './strategies/bm25.js'
import { EmbeddingSearchStrategy } from './strategies/embedding.js'
import { RegexSearchStrategy } from './strategies/regex.js'

export { BM25SearchStrategy } from './strategies/bm25.js'
export { EmbeddingSearchStrategy } from './strategies/embedding.js'
export { RegexSearchStrategy } from './strategies/regex.js'
export { type SearchStrategy } from './strategy.js'

/**
 * Search orchestrator options
 */
export interface SearchOrchestratorOptions {
  defaultMode?: SearchMode
  defaultTopK?: number
  embeddingProvider?: EmbeddingProvider
}

/**
 * Orchestrates search operations using different strategies
 */
export class SearchOrchestrator {
  private strategies: Map<SearchMode, SearchStrategy>
  private defaultMode: SearchMode
  private defaultTopK: number
  private initialized = false

  constructor(options?: SearchOrchestratorOptions) {
    this.defaultMode = options?.defaultMode ?? 'bm25'
    this.defaultTopK = options?.defaultTopK ?? 10

    // Initialize strategies
    this.strategies = new Map()
    this.strategies.set('regex', new RegexSearchStrategy())
    this.strategies.set('bm25', new BM25SearchStrategy())
    this.strategies.set('embedding', new EmbeddingSearchStrategy(options?.embeddingProvider))
  }

  /**
   * Set embedding provider for semantic search
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    const embeddingStrategy = this.strategies.get('embedding') as EmbeddingSearchStrategy
    embeddingStrategy.setEmbeddingProvider(provider)
  }

  /**
   * Set BM25 statistics
   */
  setBM25Stats(stats: BM25Stats): void {
    const bm25Strategy = this.strategies.get('bm25') as BM25SearchStrategy
    bm25Strategy.setStats(stats)
  }

  /**
   * Initialize all strategies
   */
  async initialize(): Promise<void> {
    if (this.initialized)
      return

    for (const strategy of this.strategies.values()) {
      await strategy.initialize()
    }

    this.initialized = true
  }

  /**
   * Search indexed tools
   */
  async search(query: SearchQuery, indexedTools: IndexedTool[]): Promise<SearchResult> {
    const mode = query.mode ?? this.defaultMode
    const strategy = this.strategies.get(mode)

    if (!strategy) {
      throw new Error(`Unknown search mode: ${mode}`)
    }

    const options: SearchOptions = {
      topK: query.topK ?? this.defaultTopK,
      threshold: query.threshold,
    }

    const startTime = performance.now()
    const tools = await strategy.search(query.query, indexedTools, options)
    const endTime = performance.now()

    return {
      tools,
      query: query.query,
      mode,
      totalIndexed: indexedTools.length,
      searchTimeMs: Math.round(endTime - startTime),
    }
  }

  /**
   * Search with a simple query string
   */
  async simpleSearch(
    query: string,
    indexedTools: IndexedTool[],
    mode?: SearchMode,
    topK?: number,
  ): Promise<SearchResult> {
    return this.search(
      {
        query,
        mode: mode ?? this.defaultMode,
        topK: topK ?? this.defaultTopK,
      },
      indexedTools,
    )
  }

  /**
   * Get available search modes
   */
  getAvailableModes(): SearchMode[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * Check if embedding search is available
   */
  hasEmbeddingSupport(): boolean {
    // Check if embedding strategy has a provider configured
    return this.strategies.has('embedding')
  }

  /**
   * Dispose all strategies
   */
  async dispose(): Promise<void> {
    for (const strategy of this.strategies.values()) {
      await strategy.dispose()
    }
    this.initialized = false
  }
}
