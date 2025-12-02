// Core types
export * from './types/index.js';

// Index management
export { IndexManager, ToolLoader, IndexBuilder, IndexStorage } from './index/index.js';
export type { PersistedIndex, BM25Stats } from './index/storage.js';

// Search
export {
  SearchOrchestrator,
  RegexSearchStrategy,
  BM25SearchStrategy,
  EmbeddingSearchStrategy,
} from './search/index.js';
export type { SearchStrategy } from './search/strategy.js';

// Embedding providers
export {
  EmbeddingProviderRegistry,
  MiniLMEmbeddingProvider,
  MDBRLeafEmbeddingProvider,
  OpenAIEmbeddingProvider,
  VoyageAIEmbeddingProvider,
  createEmbeddingProvider,
  defaultRegistry,
} from './embedding/index.js';
export type { EmbeddingProvider } from './embedding/provider.js';
