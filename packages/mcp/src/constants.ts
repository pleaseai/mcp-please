import type { EmbeddingProviderType, SearchMode } from '@pleaseai/mcp-core'
import type { CliScope, IndexScope } from './types/index-scope.js'

/**
 * Default index file path
 */
export const DEFAULT_INDEX_PATH = '.please/mcp/index.json'

/**
 * Default search mode
 */
export const DEFAULT_SEARCH_MODE: SearchMode = 'bm25'

/**
 * Default embedding provider
 */
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderType = 'local:mdbr-leaf'

/**
 * Default top-k results
 */
export const DEFAULT_TOP_K = 10

/**
 * MCP server name
 */
export const MCP_SERVER_NAME = 'pleaseai-mcp'

/**
 * Package name for npx usage
 */
export const PACKAGE_NAME = '@pleaseai/mcp'

/**
 * Default index scope for index command
 */
export const DEFAULT_INDEX_SCOPE: IndexScope = 'project'

/**
 * Default CLI scope for search/serve commands (includes both scopes)
 */
export const DEFAULT_CLI_SCOPE: CliScope = 'all'
