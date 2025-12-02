import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createEmbeddingProvider,
  EmbeddingProviderRegistry,
  MDBRLeafEmbeddingProvider,
  MiniLMEmbeddingProvider,
} from '../src/embedding/index.js'

describe('MiniLMEmbeddingProvider', () => {
  let provider: MiniLMEmbeddingProvider

  beforeAll(async () => {
    provider = new MiniLMEmbeddingProvider()
    await provider.initialize()
  })

  afterAll(async () => {
    await provider.dispose()
  })

  test('should have correct name and dimensions', () => {
    expect(provider.name).toBe('local:minilm')
    expect(provider.dimensions).toBe(384)
  })

  test('should generate embeddings for single text', async () => {
    const embedding = await provider.embed('Hello world')

    expect(embedding).toBeArray()
    expect(embedding).toHaveLength(384)
    expect(embedding[0]).toBeNumber()
  })

  test('should generate normalized embeddings', async () => {
    const embedding = await provider.embed('Test text')

    // Check L2 norm is approximately 1
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
    expect(norm).toBeCloseTo(1, 2)
  })

  test('should generate embeddings for batch', async () => {
    const texts = ['First text', 'Second text', 'Third text']
    const embeddings = await provider.embedBatch(texts)

    expect(embeddings).toHaveLength(3)
    for (const embedding of embeddings) {
      expect(embedding).toHaveLength(384)
    }
  })

  test('should produce similar embeddings for similar texts', async () => {
    const emb1 = await provider.embed('The quick brown fox')
    const emb2 = await provider.embed('A fast brown fox')
    const emb3 = await provider.embed('Database query optimization')

    // Cosine similarity
    const cosineSim = (a: number[], b: number[]) =>
      a.reduce((sum, val, i) => sum + val * b[i], 0)

    const sim12 = cosineSim(emb1, emb2)
    const sim13 = cosineSim(emb1, emb3)

    // Similar texts should have higher similarity
    expect(sim12).toBeGreaterThan(sim13)
  })
}, 60000)

describe('MDBRLeafEmbeddingProvider', () => {
  let provider: MDBRLeafEmbeddingProvider

  beforeAll(async () => {
    provider = new MDBRLeafEmbeddingProvider()
    await provider.initialize()
  })

  afterAll(async () => {
    await provider.dispose()
  })

  test('should have correct name and dimensions', () => {
    expect(provider.name).toBe('local:mdbr-leaf')
    expect(provider.dimensions).toBe(256)
  })

  test('should generate embeddings with MRL truncation', async () => {
    const embedding = await provider.embed('Hello world')

    expect(embedding).toBeArray()
    expect(embedding).toHaveLength(256)
  })

  test('should generate normalized embeddings after truncation', async () => {
    const embedding = await provider.embed('Test text')

    // Check L2 norm is approximately 1 (re-normalized after truncation)
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
    expect(norm).toBeCloseTo(1, 2)
  })

  test('should support custom dimensions', async () => {
    const customProvider = new MDBRLeafEmbeddingProvider(undefined, 128)
    await customProvider.initialize()

    const embedding = await customProvider.embed('Test')
    expect(embedding).toHaveLength(128)

    await customProvider.dispose()
  })

  test('should produce similar embeddings for similar texts', async () => {
    const emb1 = await provider.embed('Read file from disk')
    const emb2 = await provider.embed('Load file from filesystem')
    const emb3 = await provider.embed('Send email notification')

    const cosineSim = (a: number[], b: number[]) =>
      a.reduce((sum, val, i) => sum + val * b[i], 0)

    const sim12 = cosineSim(emb1, emb2)
    const sim13 = cosineSim(emb1, emb3)

    expect(sim12).toBeGreaterThan(sim13)
  })
}, 60000)

describe('EmbeddingProviderRegistry', () => {
  test('should list available types', () => {
    const registry = new EmbeddingProviderRegistry()
    const types = registry.getAvailableTypes()

    expect(types).toContain('local:minilm')
    expect(types).toContain('local:mdbr-leaf')
    expect(types).toContain('api:openai')
    expect(types).toContain('api:voyage')
  })

  test('should create local:minilm provider', () => {
    const provider = createEmbeddingProvider({ type: 'local:minilm' })

    expect(provider.name).toBe('local:minilm')
    expect(provider.dimensions).toBe(384)
  })

  test('should create local:mdbr-leaf provider', () => {
    const provider = createEmbeddingProvider({ type: 'local:mdbr-leaf' })

    expect(provider.name).toBe('local:mdbr-leaf')
    expect(provider.dimensions).toBe(256)
  })

  test('should create local:mdbr-leaf with custom dimensions', () => {
    const provider = createEmbeddingProvider({
      type: 'local:mdbr-leaf',
      dimensions: 128,
    })

    expect(provider.dimensions).toBe(128)
  })

  test('should throw for unknown provider type', () => {
    expect(() =>
      createEmbeddingProvider({ type: 'unknown' as any }),
    ).toThrow('Unknown embedding provider type')
  })

  test('should support custom provider registration', () => {
    const registry = new EmbeddingProviderRegistry()

    registry.register('custom:test', () => ({
      name: 'custom:test',
      dimensions: 100,
      initialize: async () => {},
      embed: async () => Array.from({ length: 100 }).fill(0),
      embedBatch: async texts => texts.map(() => Array.from({ length: 100 }).fill(0)),
      dispose: async () => {},
    }))

    expect(registry.getAvailableTypes()).toContain('custom:test')

    const provider = registry.create({ type: 'custom:test' as any })
    expect(provider.name).toBe('custom:test')
  })
})
