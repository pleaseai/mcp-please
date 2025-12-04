# Search Architecture

This document explains how MCP Gateway's search engine works internally.

## Overview

MCP Gateway provides three search strategies that operate **without external databases**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Search Orchestrator                        │
│                                                                 │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │    Regex    │   │    BM25     │   │     Embedding       │   │
│  │   Strategy  │   │   Strategy  │   │      Strategy       │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
│                                                │                │
│                                       ┌────────┴────────┐       │
│                                       │    Embedding    │       │
│                                       │    Provider     │       │
│                                       └─────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │     Index (JSON file)         │
              │  .please/mcp/index.json       │
              └───────────────────────────────┘
```

## Search Modes

### 1. Regex Search

Pattern matching on tool names and descriptions.

**How it works:**
1. User provides a regex pattern (e.g., `read.*file`)
2. Pattern is compiled and tested against each tool's `searchableText`
3. Matching tools are returned (score = 1.0 for all matches)

**Best for:**
- Finding tools with specific naming patterns
- Exact or partial name lookups
- Simple wildcard searches

**Complexity:** O(n × m) where n = tools, m = pattern length

### 2. BM25 Search (Default)

Traditional text search using the BM25 ranking algorithm (Best Matching 25).

**How it works:**
1. At index time: tokenize each tool's description into terms
2. At search time: tokenize query and compute BM25 scores
3. BM25 considers:
   - **Term Frequency (TF)**: How often the term appears in the document
   - **Inverse Document Frequency (IDF)**: How rare the term is across all documents
   - **Document length normalization**: Longer documents don't automatically score higher

**Formula:**
```
score(D, Q) = Σ IDF(qi) × (tf(qi, D) × (k1 + 1)) / (tf(qi, D) + k1 × (1 - b + b × |D|/avgdl))
```

Where:
- k1 = 1.2 (term frequency saturation)
- b = 0.75 (document length normalization)

**Best for:**
- Keyword-based searches
- When exact terminology is known
- Fast, no external dependencies

**Complexity:** O(n × q) where n = tools, q = query tokens

### 3. Embedding Search (Semantic)

Vector similarity search using cosine similarity.

**How it works:**

```
┌─────────────┐                    ┌─────────────────────┐
│ Index Time  │                    │    Search Time      │
└──────┬──────┘                    └──────────┬──────────┘
       │                                      │
       ▼                                      ▼
┌──────────────┐                    ┌──────────────┐
│ Tool         │                    │ Query        │
│ Description  │                    │ "find files" │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       ▼                                   ▼
┌──────────────────┐               ┌──────────────────┐
│ Embedding Model  │               │ Embedding Model  │
│ (transformers.js)│               │ (same model)     │
└──────┬───────────┘               └──────┬───────────┘
       │                                   │
       ▼                                   ▼
┌──────────────────┐               ┌──────────────────┐
│ Vector [0.1, ...]│               │ Vector [0.2, ...]│
│ (256-384 dims)   │               │ (256-384 dims)   │
└──────┬───────────┘               └──────────┬───────┘
       │                                      │
       ▼                                      │
┌──────────────────┐                          │
│ Stored in        │◄─────────────────────────┘
│ index.json       │      Cosine Similarity
└──────────────────┘      Comparison (in memory)
```

1. **Indexing Phase:**
   - Each tool's description is converted to a dense vector (embedding)
   - Embeddings are stored in the JSON index file alongside tool metadata

2. **Search Phase:**
   - Query text is converted to a vector using the same embedding model
   - Cosine similarity is computed between query vector and all stored vectors
   - Results are ranked by similarity score

**Cosine Similarity:**
```
similarity(A, B) = (A · B) / (||A|| × ||B||)
```

Returns a value between -1 and 1, normalized to 0-1 for scoring.

**Best for:**
- Natural language queries
- Finding semantically similar tools
- When exact terminology is unknown

**Complexity:** O(n × d) where n = tools, d = embedding dimensions

## Why No Vector Database?

MCP Gateway intentionally uses **in-memory linear search** instead of a vector database:

| Factor | In-Memory (Current) | Vector DB |
|--------|---------------------|-----------|
| **Latency** | <10ms for 1000 tools | Network overhead |
| **Dependencies** | Zero | Requires service |
| **Deployment** | Single binary | Additional infrastructure |
| **Scale Target** | 10-10,000 tools | Millions+ |
| **Index Persistence** | JSON file | Separate storage |

**Design Rationale:**

Most MCP tool collections contain 10-1000 tools. At this scale:
- Linear scan is fast enough (<100ms even for 10K tools)
- Approximate Nearest Neighbor (ANN) algorithms add complexity without benefit
- JSON file storage enables easy backup, versioning, and debugging

**When to consider a Vector DB:**
- >100,000 tools
- Sub-millisecond latency requirements
- Distributed search across multiple nodes

## Index Structure

The search index is stored as a JSON file (`.please/mcp/index.json`):

```json
{
  "version": "1.0.0",
  "createdAt": "2024-01-15T10:30:00Z",
  "embeddingProvider": "local:mdbr-leaf",
  "embeddingDimensions": 256,
  "tools": [
    {
      "tool": {
        "name": "filesystem__read_file",
        "title": "Read File",
        "description": "Read contents of a file",
        "inputSchema": { ... }
      },
      "searchableText": "read_file Read File Read contents of a file",
      "tokens": ["read", "file", "contents"],
      "embedding": [0.123, -0.456, ...],  // 256 floats
      "serverName": "filesystem"
    }
  ]
}
```

## Embedding Providers

| Provider | Model | Dimensions | Memory | API Key |
|----------|-------|------------|--------|---------|
| `local:mdbr-leaf` | MongoDB/mdbr-leaf-ir | 256 | ~90MB | No |
| `local:minilm` | all-MiniLM-L6-v2 | 384 | ~90MB | No |
| `api:openai` | text-embedding-3-small | 1536 | - | Yes |
| `api:voyage` | voyage-3-lite | 512 | - | Yes |

See [Embedding Model Comparison](./embedding-models.md) for detailed benchmarks.

## Performance Characteristics

### Indexing Performance

| Tools | BM25 Only | With Embeddings |
|-------|-----------|-----------------|
| 100 | <1s | ~5s |
| 1,000 | ~2s | ~30s |
| 10,000 | ~10s | ~5min |

Embedding generation is the primary bottleneck during indexing.

### Search Performance

| Tools | Regex | BM25 | Embedding |
|-------|-------|------|-----------|
| 100 | <1ms | <1ms | ~5ms |
| 1,000 | ~5ms | ~10ms | ~50ms |
| 10,000 | ~50ms | ~100ms | ~500ms |

Times include model inference for embedding mode.

## Architecture Components

### SearchStrategy Interface

```typescript
interface SearchStrategy {
  readonly mode: SearchMode
  initialize(): Promise<void>
  search(query: string, tools: IndexedTool[], options: SearchOptions): Promise<ToolReference[]>
  dispose(): Promise<void>
}
```

### SearchOrchestrator

Routes queries to the appropriate strategy:

```typescript
class SearchOrchestrator {
  // Register strategies
  registerStrategy(strategy: SearchStrategy): void

  // Execute search with specified mode
  search(query: string, tools: IndexedTool[], options: SearchOptions): Promise<ToolReference[]>
}
```

### EmbeddingProvider Interface

```typescript
interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  initialize(): Promise<void>
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  dispose(): Promise<void>
}
```

## Best Practices

### Choosing a Search Mode

| Scenario | Recommended Mode |
|----------|------------------|
| Know the exact tool name | `regex` |
| Keyword search | `bm25` |
| Natural language query | `embedding` |
| Fastest results | `bm25` |
| Most accurate semantic match | `embedding` |

### Index Optimization

1. **Skip embeddings for speed**: Use `--no-embeddings` if you only need regex/BM25
2. **Use quantized models**: Add `--dtype q8` to reduce memory usage
3. **Pre-warm the model**: First embedding search is slower due to model loading

### Memory Considerations

- Index size ≈ (tools × 256 × 4 bytes) for embeddings + metadata
- 1,000 tools ≈ 1-2MB index file
- Model memory: ~90MB for local providers

## Limitations

1. **No incremental updates**: Full re-index required when tools change
2. **Single-node only**: No distributed search support
3. **Memory-bound**: All embeddings must fit in RAM during search
4. **Model loading**: First semantic search has ~2-5s cold start

## Future Considerations

For large-scale deployments (>100K tools), consider:

- **Vector databases**: Qdrant, Milvus, Pinecone for ANN search
- **Hybrid search**: Combine BM25 pre-filtering with embedding re-ranking
- **Streaming indexes**: Process tools without loading all into memory
