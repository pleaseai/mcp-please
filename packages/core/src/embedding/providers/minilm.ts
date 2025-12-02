import type { ModelDtype } from '../../types/index.js'
import type { EmbeddingProvider } from '../provider.js'

// Simplified type for transformers.js pipeline
type Pipeline = any

/**
 * MiniLM embedding provider using transformers.js
 * Uses all-MiniLM-L6-v2 model (384 dimensions)
 *
 * General-purpose embedding model suitable for various NLP tasks.
 *
 * @see https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 */
export class MiniLMEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local:minilm'
  readonly dimensions = 384

  private extractor: Pipeline | null = null
  private modelName: string
  private dtype: ModelDtype

  /**
   * @param modelName - Model name (default: Xenova/all-MiniLM-L6-v2)
   * @param dtype - Model dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' (default: 'fp32')
   */
  constructor(modelName?: string, dtype?: ModelDtype) {
    this.modelName = modelName ?? 'Xenova/all-MiniLM-L6-v2'
    this.dtype = dtype ?? 'fp32'
  }

  async initialize(): Promise<void> {
    if (this.extractor)
      return

    // Dynamic import for transformers.js
    const { pipeline } = await import('@huggingface/transformers')

    this.extractor = await pipeline('feature-extraction', this.modelName, {
      dtype: this.dtype,
    })
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      await this.initialize()
    }

    const output = await this.extractor!(text, {
      pooling: 'mean',
      normalize: true,
    })

    // Convert to regular array - handle Tensor output from transformers.js
    const tensor = output as { data: Float32Array | number[] }
    return Array.from(tensor.data)
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      await this.initialize()
    }

    const results: number[][] = []

    // Process texts one by one to avoid memory issues
    // transformers.js batch processing can be memory-intensive
    for (const text of texts) {
      const embedding = await this.embed(text)
      results.push(embedding)
    }

    return results
  }

  async dispose(): Promise<void> {
    this.extractor = null
  }
}
