import type { IndexedTool } from '../types/index.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Persisted index format
 */
export interface PersistedIndex {
  version: string
  createdAt: string
  updatedAt: string
  totalTools: number
  hasEmbeddings: boolean
  embeddingModel?: string
  embeddingDimensions?: number
  bm25Stats: BM25Stats
  tools: IndexedTool[]
}

/**
 * BM25 precomputed statistics
 */
export interface BM25Stats {
  avgDocLength: number
  documentFrequencies: Record<string, number>
  totalDocuments: number
}

/**
 * Storage manager for persisting and loading index
 */
export class IndexStorage {
  private readonly version = '1.0.0'

  /**
   * Save index to file
   */
  async save(
    indexedTools: IndexedTool[],
    outputPath: string,
    options?: {
      embeddingModel?: string
      embeddingDimensions?: number
    },
  ): Promise<void> {
    const bm25Stats = this.computeBM25Stats(indexedTools)
    const hasEmbeddings = indexedTools.some(t => t.embedding && t.embedding.length > 0)

    const persistedIndex: PersistedIndex = {
      version: this.version,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalTools: indexedTools.length,
      hasEmbeddings,
      embeddingModel: options?.embeddingModel,
      embeddingDimensions: options?.embeddingDimensions,
      bm25Stats,
      tools: indexedTools,
    }

    // Ensure directory exists
    await mkdir(dirname(outputPath), { recursive: true })

    // Write JSON with pretty formatting
    await writeFile(outputPath, JSON.stringify(persistedIndex, null, 2), 'utf-8')
  }

  /**
   * Load index from file
   */
  async load(inputPath: string): Promise<PersistedIndex> {
    const content = await readFile(inputPath, 'utf-8')
    const data = JSON.parse(content) as PersistedIndex

    // Validate version compatibility
    if (!data.version) {
      throw new Error('Invalid index file: missing version')
    }

    const [major] = data.version.split('.')
    const [currentMajor] = this.version.split('.')

    if (major !== currentMajor) {
      throw new Error(`Index version ${data.version} is incompatible with current version ${this.version}`)
    }

    return data
  }

  /**
   * Check if index file exists and is valid
   */
  async exists(indexPath: string): Promise<boolean> {
    try {
      await this.load(indexPath)
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Create an empty index file
   */
  async createEmpty(outputPath: string): Promise<void> {
    await this.save([], outputPath)
  }

  /**
   * Ensure index file exists, creating an empty one if not
   * @returns true if index was created, false if it already existed
   */
  async ensureExists(indexPath: string): Promise<boolean> {
    const indexExists = await this.exists(indexPath)
    if (!indexExists) {
      await this.createEmpty(indexPath)
      return true
    }
    return false
  }

  /**
   * Compute BM25 statistics from indexed tools
   */
  private computeBM25Stats(indexedTools: IndexedTool[]): BM25Stats {
    const documentFrequencies: Record<string, number> = {}
    let totalLength = 0

    for (const indexed of indexedTools) {
      const uniqueTokens = new Set(indexed.tokens)
      totalLength += indexed.tokens.length

      for (const token of uniqueTokens) {
        documentFrequencies[token] = (documentFrequencies[token] || 0) + 1
      }
    }

    return {
      avgDocLength: indexedTools.length > 0 ? totalLength / indexedTools.length : 0,
      documentFrequencies,
      totalDocuments: indexedTools.length,
    }
  }

  /**
   * Get index metadata without loading full tools
   */
  async getMetadata(indexPath: string): Promise<Omit<PersistedIndex, 'tools' | 'bm25Stats'>> {
    const index = await this.load(indexPath)

    return {
      version: index.version,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
      totalTools: index.totalTools,
      hasEmbeddings: index.hasEmbeddings,
      embeddingModel: index.embeddingModel,
      embeddingDimensions: index.embeddingDimensions,
    }
  }
}
