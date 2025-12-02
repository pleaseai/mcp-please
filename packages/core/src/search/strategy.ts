import type { IndexedTool, SearchMode, SearchOptions, ToolReference } from '../types/index.js'

/**
 * Strategy pattern interface for search algorithms
 */
export interface SearchStrategy {
  /**
   * Unique identifier for this strategy
   */
  readonly mode: SearchMode

  /**
   * Initialize the strategy (e.g., load models)
   */
  initialize: () => Promise<void>

  /**
   * Search indexed tools
   */
  search: (query: string, indexedTools: IndexedTool[], options: SearchOptions) => Promise<ToolReference[]>

  /**
   * Cleanup resources
   */
  dispose: () => Promise<void>
}
