# Session Summary: Hybrid Search

## Feature Description
Implement hybrid search combining BM25 (lexical) + embedding (semantic) with Reciprocal Rank Fusion (RRF) for score combination.

## Requirements Summary
From GitHub Issue #23:

1. **Score fusion:** RRF (Reciprocal Rank Fusion) with k=60
2. **Embedding requirement:** Required (fail if embeddings missing)
3. **API design:** New `'hybrid'` SearchMode value

### RRF Algorithm
```
RRF_score(d) = Σ 1/(k + rank_i(d))  where k=60
```

### Key Design Decisions (from issue)
1. **Composition:** HybridSearchStrategy composes existing BM25 and Embedding strategies
2. **Parallel execution:** Both searches run via `Promise.all()`
3. **Expanded fetch:** Request 3x topK from each strategy for better fusion
4. **Score normalization:** Final scores normalized to 0-1 range
5. **Fail-fast:** Clear error message if embeddings missing

### Files to Modify (from issue)
| File | Change |
|------|--------|
| `packages/core/src/types/tool.ts` | Add `'hybrid'` to SearchMode type |
| `packages/core/src/search/strategies/hybrid.ts` | **NEW** - HybridSearchStrategy |
| `packages/core/src/search/index.ts` | Register hybrid strategy in orchestrator |
| `packages/core/src/index.ts` | Export HybridSearchStrategy |
| `packages/mcp/src/server.ts` | Add 'hybrid' to mode enum |
| `packages/mcp/src/commands/search.ts` | Support hybrid mode in CLI |

## Constraints and Limitations
- Must compose existing BM25 and Embedding strategies
- Embeddings must exist in index (fail-fast if missing)
- RRF constant k=60 (standard value)

## Current Phase
**Phase 5: GitHub Issue & PR** - In Progress

## Phase 4: Architecture Design - Complete

### Chosen Architecture: Minimal with Clean RRF

**Approach**: Compose existing strategies, inline RRF in HybridSearchStrategy

**Key Design Decisions**:
1. HybridSearchStrategy composes BM25 + Embedding strategies via constructor injection
2. RRF logic (~20 lines) inline in the strategy class
3. Parallel execution via Promise.all()
4. 3x topK expansion for better fusion coverage
5. Fail-fast if embeddings missing

**Files to Create/Modify**:
| Task | File | Change |
|------|------|--------|
| T001 | `packages/core/src/types/tool.ts` | Add `'hybrid'` to SearchMode |
| T002 | `packages/core/src/search/strategies/hybrid.ts` | NEW - HybridSearchStrategy |
| T003 | `packages/core/src/search/index.ts` | Register hybrid in orchestrator |
| T004 | `packages/core/src/index.ts` | Export HybridSearchStrategy |
| T005 | `packages/mcp/src/server.ts` | Add 'hybrid' to Zod enum |
| T006 | `packages/mcp/src/commands/search.ts` | Update CLI help text |
| T007 | `packages/core/tests/hybrid-search.test.ts` | NEW - Unit tests

## Phase 3: Clarifying Questions - Complete

### Decisions Made
| Question | Decision | Rationale |
|----------|----------|-----------|
| RRF weights | Equal, no parameter | Standard approach, simplicity |
| Provider init | Composition via orchestrator | Follows existing patterns |
| topK multiplier | Fixed 3x | Internal detail, avoid over-engineering |
| availableModes | Conditional on embeddings | Consistent UX |
| Tests | Yes, unit tests in core | Quality assurance |

## Phase 2: Codebase Exploration - Complete

## Phase 2: Codebase Patterns Found

### Search Strategy Architecture
- **Strategy Pattern**: `SearchStrategy` interface in `packages/core/src/search/strategy.ts`
  - `mode: SearchMode` - Read-only identifier
  - `initialize(): Promise<void>` - Setup phase
  - `search(query, tools, options): Promise<ToolReference[]>` - Main search
  - `dispose(): Promise<void>` - Cleanup

### Existing Strategy Implementations
| Strategy | File | Key Features |
|----------|------|--------------|
| BM25SearchStrategy | `strategies/bm25.ts` | Term frequency, k1=1.5, b=0.75, normalizes to 0-1 |
| EmbeddingSearchStrategy | `strategies/embedding.ts` | Cosine similarity, requires provider, normalizes to 0-1 |
| RegexSearchStrategy | `strategies/regex.ts` | Pattern matching, graceful fallback |

### SearchOrchestrator (`packages/core/src/search/index.ts`)
- Manages `Map<SearchMode, SearchStrategy>`
- Strategies registered in constructor (lines 37-40)
- `search()` routes by mode, returns `SearchResult`
- Has setters: `setEmbeddingProvider()`, `setBM25Stats()`

### Score Normalization Convention
All strategies normalize scores to 0-1 range:
- BM25: Divides by max score
- Embedding: `(cosine + 1) / 2`

### Where to Update for New Mode
1. **Type**: `packages/core/src/types/tool.ts:51` - `SearchMode` union type
2. **Strategy**: Create `packages/core/src/search/strategies/hybrid.ts`
3. **Orchestrator**: `packages/core/src/search/index.ts` - Register in constructor
4. **Exports**: `packages/core/src/index.ts` - Export new strategy
5. **MCP Server**: `packages/mcp/src/server.ts:93` - Zod enum
6. **CLI**: `packages/mcp/src/commands/search.ts:21` - Help text

### Key Files Read
- `packages/core/src/types/tool.ts` - SearchMode, ToolReference types
- `packages/core/src/search/strategy.ts` - SearchStrategy interface
- `packages/core/src/search/index.ts` - SearchOrchestrator
- `packages/core/src/search/strategies/bm25.ts` - BM25 implementation
- `packages/core/src/search/strategies/embedding.ts` - Embedding implementation
- `packages/mcp/src/server.ts` - MCP server with Zod validation
- `packages/mcp/src/commands/search.ts` - CLI search command
- `packages/core/src/index.ts` - Package exports

## Session Started
2025-12-04
