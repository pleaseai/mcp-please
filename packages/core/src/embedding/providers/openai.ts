import type { EmbeddingProvider } from '../provider.js'
import process from 'node:process'
import OpenAI from 'openai'

/**
 * OpenAI embedding provider
 * Uses text-embedding-3-small by default (1536 dimensions)
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai'
  readonly dimensions: number

  private client: OpenAI | null = null
  private model: string
  private apiKey?: string
  private apiBase?: string

  constructor(options?: { model?: string, apiKey?: string, apiBase?: string, dimensions?: number }) {
    this.model = options?.model ?? 'text-embedding-3-small'
    this.apiKey = options?.apiKey
    this.apiBase = options?.apiBase
    this.dimensions = options?.dimensions ?? 1536
  }

  async initialize(): Promise<void> {
    if (this.client)
      return

    const apiKey = this.apiKey ?? process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key not provided. Set OPENAI_API_KEY environment variable or pass apiKey option.')
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: this.apiBase,
    })
  }

  async embed(text: string): Promise<number[]> {
    if (!this.client) {
      await this.initialize()
    }

    const response = await this.client!.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    })

    return response.data[0].embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      await this.initialize()
    }

    // OpenAI supports batch embedding natively
    const response = await this.client!.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    })

    // Sort by index to maintain order
    return response.data.sort((a, b) => a.index - b.index).map(item => item.embedding)
  }

  async dispose(): Promise<void> {
    this.client = null
  }
}
