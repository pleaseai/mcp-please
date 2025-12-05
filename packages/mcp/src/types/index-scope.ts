/**
 * Index scope type definitions for scope-based index storage
 */

/**
 * Index storage scope
 * - 'project': Project-level index at .please/mcp/index.json (cwd)
 * - 'user': User-level index at ~/.please/mcp/index.json
 */
export type IndexScope = 'project' | 'user'

/**
 * CLI scope option that includes 'all' for operations spanning both scopes
 */
export type CliScope = IndexScope | 'all'

/**
 * All available index scopes
 */
export const INDEX_SCOPES: readonly IndexScope[] = ['project', 'user'] as const
