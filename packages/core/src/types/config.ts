import type { SearchMode } from './tool.js';

/**
 * Embedding provider types
 * Format: 'location:model' where location is 'local' or 'api'
 *
 * Local providers (run on device):
 * - local:minilm     - all-MiniLM-L6-v2 (384 dims, general purpose)
 * - local:mdbr-leaf  - MongoDB MDBR-Leaf-IR (256 dims, optimized for search)
 *
 * API providers (remote):
 * - api:openai       - OpenAI Embeddings API
 * - api:voyage       - Voyage AI API
 */
export type EmbeddingProviderType =
  | 'local:minilm'
  | 'local:mdbr-leaf'
  | 'api:openai'
  | 'api:voyage';

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  type: EmbeddingProviderType;
  model?: string;
  apiKey?: string;
  apiBase?: string;
  dimensions?: number;
  options?: Record<string, unknown>;
}

/**
 * Index configuration
 */
export interface IndexConfig {
  name: string;
  toolSources: string[];
  embeddingProvider?: EmbeddingProviderConfig;
  outputPath: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  transport: 'stdio' | 'http';
  port?: number;
  indexPath: string;
  defaultMode: SearchMode;
  embeddingProvider?: EmbeddingProviderConfig;
}

/**
 * Application configuration
 */
export interface AppConfig {
  defaultSearchMode: SearchMode;
  defaultTopK: number;
  indexPath: string;
  embeddingProvider: EmbeddingProviderConfig;
  server?: {
    transport: 'stdio' | 'http';
    port?: number;
  };
}
