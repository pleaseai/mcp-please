import type { IndexedTool, SearchMode, SearchOptions, ToolReference } from '../../types/index.js'
import type { SearchStrategy } from '../strategy.js'

/**
 * Regex-based search strategy
 * Performs pattern matching on tool names and descriptions
 */
export class RegexSearchStrategy implements SearchStrategy {
  readonly mode: SearchMode = 'regex'

  async initialize(): Promise<void> {
    // No initialization needed for regex search
  }

  async search(query: string, indexedTools: IndexedTool[], options: SearchOptions): Promise<ToolReference[]> {
    let regex: RegExp

    try {
      regex = new RegExp(query, 'gi')
    }
    catch {
      // If invalid regex, escape special characters and treat as literal
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(escaped, 'gi')
    }

    const results: ToolReference[] = []

    for (const indexed of indexedTools) {
      const matches = indexed.searchableText.match(regex)

      if (matches) {
        const score = this.calculateScore(matches, indexed.searchableText, query)

        if (score >= (options.threshold ?? 0)) {
          results.push({
            name: indexed.tool.name,
            title: indexed.tool.title,
            description: indexed.tool.description,
            score,
            matchType: 'regex',
          })
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, options.topK)
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Calculate score based on match characteristics
   */
  private calculateScore(matches: RegExpMatchArray, text: string, query: string): number {
    // Base score from match count
    const matchCount = matches.length

    // Density: how much of the text is covered by matches
    const matchLength = matches.reduce((sum, m) => sum + m.length, 0)
    const density = matchLength / text.length

    // Position bonus: early matches score higher
    const firstMatchIndex = text.toLowerCase().indexOf(matches[0].toLowerCase())
    const positionBonus = 1 - firstMatchIndex / text.length

    // Exact match bonus
    const exactMatchBonus = matches.some(m => m.toLowerCase() === query.toLowerCase()) ? 0.3 : 0

    // Combine factors
    const score = Math.min(1, density * 2 + matchCount * 0.1 + positionBonus * 0.2 + exactMatchBonus)

    return Math.round(score * 1000) / 1000
  }
}
