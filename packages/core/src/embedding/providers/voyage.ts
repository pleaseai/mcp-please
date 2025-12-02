import type { EmbeddingProvider } from '../provider.js'
import process from 'node:process'

/**
 * Voyage AI API response types
 */
interface VoyageEmbeddingResponse {
  object: string
  data: Array<{
    object: string
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    total_tokens: number
  }
}

/**
 * Voyage AI embedding provider
 * Uses voyage-3-lite by default (1024 dimensions)
 */
export class VoyageAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage'
  readonly dimensions: number

  private apiKey?: string
  private model: string
  private apiBase: string

  constructor(options?: { model?: string, apiKey?: string, apiBase?: string, dimensions?: number }) {
    this.model = options?.model ?? 'voyage-3-lite'
    this.apiKey = options?.apiKey
    this.apiBase = options?.apiBase ?? 'https://api.voyageai.com/v1'
    this.dimensions = options?.dimensions ?? 1024
  }

  async initialize(): Promise<void> {
    const apiKey = this.apiKey ?? process.env.VOYAGE_API_KEY

    if (!apiKey) {
      throw new Error('Voyage AI API key not provided. Set VOYAGE_API_KEY environment variable or pass apiKey option.')
    }

    this.apiKey = apiKey
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text])
    return embeddings[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      await this.initialize()
    }

    const response = await fetch(`${this.apiBase}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: 'document',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Voyage AI API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as VoyageEmbeddingResponse

    // Sort by index to maintain order
    return data.data.sort((a, b) => a.index - b.index).map(item => item.embedding)
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
