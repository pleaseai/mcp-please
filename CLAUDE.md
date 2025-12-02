# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Build specific package
bun run build --filter=@pleaseai/mcp-core

# Development mode (watch)
bun run dev

# Type check
bun run typecheck

# Clean build artifacts
bun run clean
```

### CLI Commands (after build)

```bash
# Index tools (without embeddings - faster)
bun apps/cli/dist/index.js index apps/cli/examples/tools.json --no-embeddings

# Index with local embeddings
bun apps/cli/dist/index.js index apps/cli/examples/tools.json

# Search tools
bun apps/cli/dist/index.js search "file operations"
bun apps/cli/dist/index.js search "read.*file" --mode regex
bun apps/cli/dist/index.js search "tools for sending messages" --mode embedding

# Start MCP server
bun apps/cli/dist/index.js serve
```

## Architecture

This is a Turborepo monorepo with three packages that implement MCP tool search functionality.

### Package Dependency Graph

```
@pleaseai/mcp-cli (apps/cli)
    ├── @pleaseai/mcp-server
    └── @pleaseai/mcp-core

@pleaseai/mcp-server (packages/server)
    └── @pleaseai/mcp-core

@pleaseai/mcp-core (packages/core)
    └── (no internal deps)
```

### Core Package (`packages/core`)

The search engine with three main subsystems:

1. **Search Strategies** (`src/search/`) - Strategy pattern implementation
   - `SearchStrategy` interface: `initialize()`, `search()`, `dispose()`
   - `RegexSearchStrategy`: Pattern matching on tool names/descriptions
   - `BM25SearchStrategy`: Term frequency ranking algorithm
   - `EmbeddingSearchStrategy`: Vector similarity search
   - `SearchOrchestrator`: Routes queries to appropriate strategy

2. **Embedding Providers** (`src/embedding/`) - Provider pattern implementation
   - `EmbeddingProvider` interface: `initialize()`, `embed()`, `embedBatch()`, `dispose()`
   - `LocalEmbeddingProvider`: all-MiniLM-L6-v2 via transformers.js
   - `OpenAIEmbeddingProvider`: OpenAI API
   - `VoyageAIEmbeddingProvider`: Voyage AI API
   - `EmbeddingProviderRegistry`: Factory for creating providers

3. **Index Management** (`src/index/`)
   - `ToolLoader`: Loads tool definitions from JSON/YAML files
   - `IndexBuilder`: Creates searchable index with tokens and optional embeddings
   - `IndexStorage`: Persists/loads index to/from JSON
   - `IndexManager`: Coordinates loading, building, and storage

### Key Types (`packages/core/src/types/`)

- `ToolDefinition`: MCP tool spec with name, description, inputSchema
- `IndexedTool`: Tool with precomputed `searchableText`, `tokens`, and optional `embedding`
- `ToolReference`: Search result with name, description, score, matchType
- `SearchMode`: `'regex' | 'bm25' | 'embedding'`

### Server Package (`packages/server`)

MCP protocol server exposing three tools:
- `tool_search`: Search with query, mode, top_k, threshold
- `tool_search_info`: Get index metadata
- `tool_search_list`: Paginated tool listing

Uses `@modelcontextprotocol/sdk` for MCP protocol implementation with stdio transport.

### CLI Package (`apps/cli`)

Commander-based CLI with three commands:
- `index`: Build search index from tool definition files
- `search`: Query the index
- `serve`: Start MCP server

## Environment Variables

```bash
OPENAI_API_KEY=sk-...    # For OpenAI embedding provider
VOYAGE_API_KEY=pa-...    # For Voyage embedding provider
```
