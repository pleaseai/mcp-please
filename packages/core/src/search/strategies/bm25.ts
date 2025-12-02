import type { BM25Stats } from '../../index/storage.js'
import type { IndexedTool, SearchMode, SearchOptions, ToolReference } from '../../types/index.js'
import type { SearchStrategy } from '../strategy.js'

/**
 * Common English stop words to filter out during tokenization
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'this',
  'which',
  'you',
  'your',
  'can',
  'could',
  'would',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'into',
  'if',
  'then',
  'than',
  'so',
  'no',
  'not',
  'only',
  'own',
  'same',
  'such',
  'too',
  'very',
  'just',
  'but',
  'also',
])

/**
 * BM25-based search strategy
 * Uses term frequency-inverse document frequency for ranking
 */
export class BM25SearchStrategy implements SearchStrategy {
  readonly mode: SearchMode = 'bm25'

  // BM25 parameters
  private readonly k1 = 1.5 // Term frequency saturation
  private readonly b = 0.75 // Document length normalization

  private stats?: BM25Stats

  async initialize(): Promise<void> {
    // Stats will be set via setStats()
  }

  /**
   * Set BM25 statistics (called when loading index)
   */
  setStats(stats: BM25Stats): void {
    this.stats = stats
  }

  async search(query: string, indexedTools: IndexedTool[], options: SearchOptions): Promise<ToolReference[]> {
    // Compute stats on-the-fly if not provided
    if (!this.stats) {
      this.stats = this.computeStats(indexedTools)
    }

    const queryTokens = this.tokenize(query)

    if (queryTokens.length === 0) {
      return []
    }

    const results: ToolReference[] = []

    for (const indexed of indexedTools) {
      const score = this.calculateBM25Score(queryTokens, indexed)

      if (score > 0 && score >= (options.threshold ?? 0)) {
        results.push({
          name: indexed.tool.name,
          title: indexed.tool.title,
          description: indexed.tool.description,
          score: Math.round(score * 1000) / 1000,
          matchType: 'bm25',
        })
      }
    }

    // Normalize scores to 0-1 range
    const maxScore = Math.max(...results.map(r => r.score), 1)
    for (const result of results) {
      result.score = Math.round((result.score / maxScore) * 1000) / 1000
    }

    return results.sort((a, b) => b.score - a.score).slice(0, options.topK)
  }

  async dispose(): Promise<void> {
    this.stats = undefined
  }

  /**
   * Calculate BM25 score for a document
   */
  private calculateBM25Score(queryTokens: string[], indexed: IndexedTool): number {
    if (!this.stats)
      return 0

    const docTokens = indexed.tokens
    const docLength = docTokens.length
    const avgDocLength = this.stats.avgDocLength
    const totalDocs = this.stats.totalDocuments

    // Count term frequencies in document
    const termFreq = new Map<string, number>()
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
    }

    let score = 0

    for (const term of queryTokens) {
      const tf = termFreq.get(term) ?? 0
      if (tf === 0)
        continue

      const df = this.stats.documentFrequencies[term] ?? 0

      // IDF calculation with smoothing
      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)

      // BM25 TF normalization
      const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLength / avgDocLength)))

      score += idf * tfNorm
    }

    return score
  }

  /**
   * Tokenize query text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  }

  /**
   * Compute BM25 stats from indexed tools
   */
  private computeStats(indexedTools: IndexedTool[]): BM25Stats {
    const documentFrequencies: Record<string, number> = {}
    let totalLength = 0

    for (const indexed of indexedTools) {
      const uniqueTokens = new Set(indexed.tokens)
      totalLength += indexed.tokens.length

      for (const token of uniqueTokens) {
        documentFrequencies[token] = (documentFrequencies[token] ?? 0) + 1
      }
    }

    return {
      avgDocLength: indexedTools.length > 0 ? totalLength / indexedTools.length : 0,
      documentFrequencies,
      totalDocuments: indexedTools.length,
    }
  }
}
