/**
 * Interface for embedding providers
 */
export interface EmbeddingProvider {
  /**
   * Provider identifier
   */
  readonly name: string

  /**
   * Embedding dimensions
   */
  readonly dimensions: number

  /**
   * Initialize the provider (e.g., load models, verify API key)
   */
  initialize: () => Promise<void>

  /**
   * Generate embeddings for a single text
   */
  embed: (text: string) => Promise<number[]>

  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch: (texts: string[]) => Promise<number[][]>

  /**
   * Cleanup resources
   */
  dispose: () => Promise<void>
}
