import type { SearchMode, ToolReference } from './tool.js'

/**
 * Search query parameters
 */
export interface SearchQuery {
  query: string
  mode: SearchMode
  topK?: number
  threshold?: number
  filters?: SearchFilters
}

/**
 * Optional filters for search
 */
export interface SearchFilters {
  namePattern?: string
  tags?: string[]
}

/**
 * Search options passed to strategy
 */
export interface SearchOptions {
  topK: number
  threshold?: number
}

/**
 * Search result
 */
export interface SearchResult {
  tools: ToolReference[]
  query: string
  mode: SearchMode
  totalIndexed: number
  searchTimeMs: number
}
