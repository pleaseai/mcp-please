import type { EmbeddingProvider } from '../provider.js';

// Dynamic import type for transformers.js
type Pipeline = Awaited<ReturnType<typeof import('@huggingface/transformers').pipeline>>;

/**
 * MDBR-Leaf-IR embedding provider using transformers.js
 *
 * Uses MongoDB/mdbr-leaf-ir model - ranked #1 on BEIR benchmark for models ≤100M params
 * Optimized for information retrieval tasks (semantic search, RAG pipelines)
 *
 * Features:
 * - 22.6M parameters (compact and fast)
 * - MRL (Matryoshka Representation Learning) support for dimension truncation
 * - Asymmetric retrieval support for enhanced performance
 *
 * @see https://huggingface.co/MongoDB/mdbr-leaf-ir
 */
export class MDBRLeafEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local:mdbr-leaf';

  private extractor: Pipeline | null = null;
  private modelName: string;
  private targetDimensions: number;

  /**
   * @param modelName - Model name (default: MongoDB/mdbr-leaf-ir)
   * @param dimensions - Target dimensions for MRL truncation (default: 256)
   */
  constructor(modelName?: string, dimensions?: number) {
    this.modelName = modelName ?? 'MongoDB/mdbr-leaf-ir';
    this.targetDimensions = dimensions ?? 256;
  }

  get dimensions(): number {
    return this.targetDimensions;
  }

  async initialize(): Promise<void> {
    if (this.extractor) return;

    const { pipeline } = await import('@huggingface/transformers');

    this.extractor = await pipeline('feature-extraction', this.modelName, {
      dtype: 'fp32',
    });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      await this.initialize();
    }

    const output = await this.extractor!(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert to regular array and apply MRL truncation
    const tensor = output as { data: Float32Array | number[] };
    const fullEmbedding = Array.from(tensor.data);

    // Truncate to target dimensions (MRL)
    return this.truncateAndNormalize(fullEmbedding, this.targetDimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      await this.initialize();
    }

    const results: number[][] = [];

    // Process texts one by one to avoid memory issues
    for (const text of texts) {
      const embedding = await this.embed(text);
      results.push(embedding);
    }

    return results;
  }

  /**
   * Truncate embedding to target dimensions and re-normalize
   * This implements MRL (Matryoshka Representation Learning)
   */
  private truncateAndNormalize(embedding: number[], targetDim: number): number[] {
    // If target is larger than embedding, return as-is
    if (targetDim >= embedding.length) {
      return embedding;
    }

    // Truncate
    const truncated = embedding.slice(0, targetDim);

    // Re-normalize to unit length
    const norm = Math.sqrt(truncated.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      return truncated.map((val) => val / norm);
    }

    return truncated;
  }

  async dispose(): Promise<void> {
    this.extractor = null;
  }
}
