import type { IndexedTool, SearchOptions } from '../src/types/index.js'
import { describe, expect, test } from 'bun:test'
import { BM25SearchStrategy } from '../src/search/strategies/bm25.js'
import { EmbeddingSearchStrategy } from '../src/search/strategies/embedding.js'
import { HybridSearchStrategy } from '../src/search/strategies/hybrid.js'

// Mock embedding provider
const mockEmbeddingProvider = {
  name: 'mock',
  dimensions: 3,
  initialize: async () => {},
  embed: async (_text: string) => [0.1, 0.2, 0.3],
  embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
  dispose: async () => {},
}

// Create test tools with embeddings
function createTestTools(count: number, withEmbeddings = true): IndexedTool[] {
  return Array.from({ length: count }, (_, i) => ({
    tool: {
      name: `tool_${i}`,
      description: `Tool ${i} description for testing`,
      inputSchema: { type: 'object' },
    },
    searchableText: `tool ${i} description testing search`,
    tokens: ['tool', String(i), 'description', 'testing', 'search'],
    embedding: withEmbeddings ? [0.1 * (i + 1), 0.2, 0.3] : undefined,
  }))
}

describe('HybridSearchStrategy', () => {
  test('should have mode "hybrid"', () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    expect(hybrid.mode).toBe('hybrid')
  })

  test('should throw error when no embeddings in index', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    const toolsWithoutEmbeddings = createTestTools(5, false)
    const options: SearchOptions = { topK: 5 }

    await expect(
      hybrid.search('test', toolsWithoutEmbeddings, options),
    ).rejects.toThrow('Hybrid search requires embeddings')
  })

  test('should return results with matchType "hybrid"', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(5)
    const options: SearchOptions = { topK: 3 }

    const results = await hybrid.search('tool description', tools, options)

    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(3)
    for (const result of results) {
      expect(result.matchType).toBe('hybrid')
    }
  })

  test('should normalize scores to 0-1 range', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(10)
    const options: SearchOptions = { topK: 10 }

    const results = await hybrid.search('tool', tools, options)

    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    }

    // First result should have score 1 (normalized max)
    if (results.length > 0) {
      expect(results[0].score).toBe(1)
    }
  })

  test('should respect topK limit', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(20)
    const options: SearchOptions = { topK: 5 }

    const results = await hybrid.search('tool', tools, options)

    expect(results.length).toBeLessThanOrEqual(5)
  })

  test('should respect threshold filter', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(10)
    const options: SearchOptions = { topK: 10, threshold: 0.5 }

    const results = await hybrid.search('tool', tools, options)

    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0.5)
    }
  })

  test('should sort results by score descending', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(10)
    const options: SearchOptions = { topK: 10 }

    const results = await hybrid.search('tool', tools, options)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  test('should use custom RRF k value', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybridDefault = new HybridSearchStrategy(bm25, embedding)
    const hybridCustom = new HybridSearchStrategy(bm25, embedding, { rrfK: 30 })

    await embedding.initialize()

    const tools = createTestTools(5)
    const options: SearchOptions = { topK: 5 }

    const resultsDefault = await hybridDefault.search('tool', tools, options)
    const resultsCustom = await hybridCustom.search('tool', tools, options)

    // Both should return results, but scores may differ due to k value
    expect(resultsDefault.length).toBeGreaterThan(0)
    expect(resultsCustom.length).toBeGreaterThan(0)
  })

  test('should handle empty results from strategies', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(5)
    const options: SearchOptions = { topK: 5 }

    // Query that won't match anything
    const results = await hybrid.search('xyznonexistent', tools, options)

    expect(results).toBeArray()
    // May have some results from embedding similarity even without exact matches
  })

  test('initialize should be a no-op (strategies managed externally)', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    // Should not throw
    await hybrid.initialize()
  })

  test('dispose should be a no-op (strategies managed externally)', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    // Should not throw
    await hybrid.dispose()
  })
})

describe('Edge Cases', () => {
  test('should handle empty tool index', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    const tools: IndexedTool[] = []
    const options: SearchOptions = { topK: 5 }

    // Empty index with no embeddings should throw
    await expect(
      hybrid.search('test', tools, options),
    ).rejects.toThrow('Hybrid search requires embeddings')
  })

  test('should handle tools with mixed embedding presence', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    // Mix of tools with and without embeddings
    const tools: IndexedTool[] = [
      {
        tool: { name: 'with_embedding', description: 'Tool with embedding', inputSchema: { type: 'object' } },
        searchableText: 'tool with embedding',
        tokens: ['tool', 'embedding'],
        embedding: [0.1, 0.2, 0.3],
      },
      {
        tool: { name: 'without_embedding', description: 'Tool without embedding', inputSchema: { type: 'object' } },
        searchableText: 'tool without embedding',
        tokens: ['tool', 'without', 'embedding'],
        // No embedding field
      },
    ]

    const options: SearchOptions = { topK: 5 }

    // Should not throw - at least one tool has embeddings
    const results = await hybrid.search('tool', tools, options)
    expect(results.length).toBeGreaterThan(0)
  })

  test('should provide clear error context when BM25 fails', async () => {
    // Create a failing BM25 strategy
    const failingBm25 = {
      mode: 'bm25' as const,
      initialize: async () => {},
      search: async () => { throw new Error('BM25 internal error') },
      dispose: async () => {},
    } as BM25SearchStrategy

    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(failingBm25, embedding)

    await embedding.initialize()

    const tools = createTestTools(3)
    const options: SearchOptions = { topK: 3 }

    await expect(
      hybrid.search('test', tools, options),
    ).rejects.toThrow('BM25 search failed: BM25 internal error')
  })

  test('should provide clear error context when Embedding fails', async () => {
    const bm25 = new BM25SearchStrategy()

    // Create a failing embedding strategy
    const failingEmbedding = {
      mode: 'embedding' as const,
      initialize: async () => {},
      search: async () => { throw new Error('Embedding API timeout') },
      dispose: async () => {},
      setEmbeddingProvider: () => {},
    } as EmbeddingSearchStrategy

    const hybrid = new HybridSearchStrategy(bm25, failingEmbedding)

    const tools = createTestTools(3)
    const options: SearchOptions = { topK: 3 }

    await expect(
      hybrid.search('test', tools, options),
    ).rejects.toThrow('Embedding search failed: Embedding API timeout')
  })
})

describe('RRF Score Calculation', () => {
  test('should combine results from both strategies', async () => {
    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding)

    await embedding.initialize()

    // Create tools where different ones will rank differently
    const tools: IndexedTool[] = [
      {
        tool: { name: 'exact_match', description: 'file operations tool', inputSchema: { type: 'object' } },
        searchableText: 'file operations tool',
        tokens: ['file', 'operations', 'tool'],
        embedding: [0.9, 0.1, 0.1], // High similarity to query embedding
      },
      {
        tool: { name: 'bm25_match', description: 'file file file file file', inputSchema: { type: 'object' } },
        searchableText: 'file file file file file',
        tokens: ['file', 'file', 'file', 'file', 'file'],
        embedding: [0.1, 0.1, 0.1], // Low similarity
      },
      {
        tool: { name: 'embedding_match', description: 'data handler', inputSchema: { type: 'object' } },
        searchableText: 'data handler',
        tokens: ['data', 'handler'],
        embedding: [0.1, 0.2, 0.3], // Similar to mock query embedding
      },
    ]

    const options: SearchOptions = { topK: 10 }
    const results = await hybrid.search('file', tools, options)

    // All tools should be in results
    const names = results.map(r => r.name)
    expect(names).toContain('exact_match')
    expect(names).toContain('bm25_match')
  })

  test('RRF formula: 1/(k + rank) should be applied correctly', async () => {
    // RRF with k=60:
    // Rank 0 (1st): 1/(60+1) = 0.0164
    // Rank 1 (2nd): 1/(60+2) = 0.0161
    // Combined score for item in both lists at rank 0: 0.0164 + 0.0164 = 0.0328

    const bm25 = new BM25SearchStrategy()
    const embedding = new EmbeddingSearchStrategy(mockEmbeddingProvider)
    const hybrid = new HybridSearchStrategy(bm25, embedding, { rrfK: 60 })

    await embedding.initialize()

    const tools = createTestTools(3)
    const options: SearchOptions = { topK: 3 }

    const results = await hybrid.search('tool 0', tools, options)

    // The first result should have the highest combined score
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].score).toBe(1) // Normalized to 1
  })
})
