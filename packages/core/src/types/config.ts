import type { SearchMode } from './tool.js'

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
export type EmbeddingProviderType
  = | 'local:minilm'
    | 'local:mdbr-leaf'
    | 'api:openai'
    | 'api:voyage'

/**
 * Model dtype (data type) for local embedding providers
 *
 * Controls memory usage and inference speed trade-offs:
 * - fp32: Full precision (default, highest accuracy)
 * - fp16: Half precision (faster on GPU, good accuracy)
 * - q8: 8-bit quantization (reduced memory, slight accuracy loss)
 * - q4: 4-bit quantization (smallest memory footprint)
 * - q4f16: 4-bit with fp16 compute (balanced option)
 */
export type ModelDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  type: EmbeddingProviderType
  model?: string
  apiKey?: string
  apiBase?: string
  dimensions?: number
  /** Model dtype for local providers (default: 'fp32') */
  dtype?: ModelDtype
  options?: Record<string, unknown>
}

/**
 * Index configuration
 */
export interface IndexConfig {
  name: string
  toolSources: string[]
  embeddingProvider?: EmbeddingProviderConfig
  outputPath: string
}

/**
 * Server configuration
 */
export interface ServerConfig {
  transport: 'stdio' | 'http'
  port?: number
  indexPath: string
  defaultMode: SearchMode
  embeddingProvider?: EmbeddingProviderConfig
}

/**
 * Application configuration
 */
export interface AppConfig {
  defaultSearchMode: SearchMode
  defaultTopK: number
  indexPath: string
  embeddingProvider: EmbeddingProviderConfig
  server?: {
    transport: 'stdio' | 'http'
    port?: number
  }
}
