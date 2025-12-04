import type { IndexedTool, SearchMode, SearchOptions, ToolReference } from '../../types/index.js'
import type { SearchStrategy } from '../strategy.js'
import type { BM25SearchStrategy } from './bm25.js'
import type { EmbeddingSearchStrategy } from './embedding.js'

/**
 * Hybrid search strategy combining BM25 and Embedding search
 * Uses Reciprocal Rank Fusion (RRF) to combine results
 */
export class HybridSearchStrategy implements SearchStrategy {
  readonly mode: SearchMode = 'hybrid'

  private readonly bm25Strategy: BM25SearchStrategy
  private readonly embeddingStrategy: EmbeddingSearchStrategy
  private readonly rrfK: number
  private readonly topKMultiplier: number

  constructor(
    bm25Strategy: BM25SearchStrategy,
    embeddingStrategy: EmbeddingSearchStrategy,
    options?: { rrfK?: number, topKMultiplier?: number },
  ) {
    this.bm25Strategy = bm25Strategy
    this.embeddingStrategy = embeddingStrategy
    this.rrfK = options?.rrfK ?? 60
    this.topKMultiplier = options?.topKMultiplier ?? 3
  }

  async initialize(): Promise<void> {
    // Strategies are initialized by orchestrator
  }

  async search(
    query: string,
    indexedTools: IndexedTool[],
    options: SearchOptions,
  ): Promise<ToolReference[]> {
    // Fail-fast: Check for embeddings before searching
    const hasEmbeddings = indexedTools.some(t => t.embedding && t.embedding.length > 0)
    if (!hasEmbeddings) {
      throw new Error('Hybrid search requires embeddings. Re-index with embeddings enabled.')
    }

    // Request 3x topK from each strategy for better fusion coverage
    const expandedOptions: SearchOptions = {
      ...options,
      topK: options.topK * this.topKMultiplier,
      threshold: 0, // Get all results above zero for fusion
    }

    // Run both searches in parallel
    const [bm25Results, embeddingResults] = await Promise.all([
      this.bm25Strategy.search(query, indexedTools, expandedOptions).catch((err) => {
        throw new Error(`BM25 search failed: ${err instanceof Error ? err.message : String(err)}`)
      }),
      this.embeddingStrategy.search(query, indexedTools, expandedOptions).catch((err) => {
        throw new Error(`Embedding search failed: ${err instanceof Error ? err.message : String(err)}`)
      }),
    ])

    // Apply Reciprocal Rank Fusion
    const fused = this.reciprocalRankFusion(bm25Results, embeddingResults)

    // Apply threshold filter and limit to topK
    const threshold = options.threshold ?? 0
    return fused
      .filter(r => r.score >= threshold)
      .slice(0, options.topK)
  }

  async dispose(): Promise<void> {
    // Strategies are disposed by orchestrator
  }

  /**
   * Reciprocal Rank Fusion algorithm
   * RRF(d) = sum(1 / (k + rank_i(d))) where rank is 1-based
   * Since JavaScript arrays are 0-indexed, we use (rank + 1) in the formula
   */
  private reciprocalRankFusion(
    bm25Results: ToolReference[],
    embeddingResults: ToolReference[],
  ): ToolReference[] {
    const scores = new Map<string, { score: number, tool: ToolReference }>()

    const addScores = (results: ToolReference[]): void => {
      results.forEach((result, rank) => {
        const rrfScore = 1 / (this.rrfK + rank + 1)
        const existing = scores.get(result.name)
        if (existing) {
          existing.score += rrfScore
        }
        else {
          scores.set(result.name, { score: rrfScore, tool: result })
        }
      })
    }

    addScores(bm25Results)
    addScores(embeddingResults)

    // Convert to array and sort by fused score
    const results = Array.from(scores.values())
    results.sort((a, b) => b.score - a.score)

    // Normalize scores to 0-1 range
    const maxScore = results.length > 0 ? results[0].score : 1
    return results.map(({ score, tool }) => ({
      ...tool,
      score: Math.round((score / maxScore) * 1000) / 1000,
      matchType: 'hybrid' as SearchMode,
    }))
  }
}
