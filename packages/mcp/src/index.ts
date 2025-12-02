// Re-export server
export { McpToolSearchServer } from './server.js'

// Re-export constants
export {
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_INDEX_PATH,
  DEFAULT_SEARCH_MODE,
  DEFAULT_TOP_K,
  MCP_SERVER_NAME,
  PACKAGE_NAME,
} from './constants.js'

// Re-export types from core
export type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderType,
  IndexedTool,
  PersistedIndex,
  SearchMode,
  SearchResult,
  ServerConfig,
  ToolDefinition,
  ToolReference,
} from '@pleaseai/mcp-core'
