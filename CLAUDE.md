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

# Run tests
bun run test

# Clean build artifacts
bun run clean
```

### CLI Commands (after build)

```bash
# Index tools from MCP servers (auto-discovers from .please/mcp.json)
bun packages/mcp/dist/cli.js index

# Index without embeddings (faster)
bun packages/mcp/dist/cli.js index --no-embeddings

# Index with specific embedding provider
bun packages/mcp/dist/cli.js index --provider local:minilm
bun packages/mcp/dist/cli.js index --provider local:mdbr-leaf  # default

# Index from specific config files
bun packages/mcp/dist/cli.js index .please/mcp.json .please/mcp.local.json

# Exclude specific servers
bun packages/mcp/dist/cli.js index --exclude server1,server2

# Search tools
bun packages/mcp/dist/cli.js search "file operations"
bun packages/mcp/dist/cli.js search "read.*file" --mode regex
bun packages/mcp/dist/cli.js search "tools for sending messages" --mode embedding

# Start MCP server
bun packages/mcp/dist/cli.js serve

# Start with auto-rebuild on config changes
bun packages/mcp/dist/cli.js serve --rebuild

# Install to IDE
bun packages/mcp/dist/cli.js install --ide claude-code --dry-run
```

## Architecture

This is a Turborepo monorepo with two packages that implement MCP tool search functionality.

### Package Dependency Graph

```
@pleaseai/mcp (packages/mcp)
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
   - `LocalEmbeddingProvider`: all-MiniLM-L6-v2 via transformers.js (384 dims)
   - `MDBRLeafEmbeddingProvider`: MongoDB MDBR-Leaf-IR (256 dims)
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
- `EmbeddingProviderType`: `'local:minilm' | 'local:mdbr-leaf' | 'api:openai' | 'api:voyage'`

### MCP Package (`packages/mcp`)

Combined CLI + MCP server package:

**CLI Commands** (`src/commands/`):
- `index-cmd.ts`: Build search index from MCP servers (auto-discovers from .please/mcp.json)
- `search.ts`: Query the index
- `serve.ts`: Start MCP server (supports --rebuild for auto-rebuild on config changes)
- `install.ts`: Install to IDE configuration

**Server** (`src/server.ts`):
MCP protocol server exposing five tools:
- `search_tools`: Search with query, mode, top_k, threshold
- `get_index_info`: Get index metadata
- `list_tools`: Paginated tool listing
- `get_tool`: Get detailed tool information including input/output schema
- `call_tool`: Execute a tool on an MCP server

The server dynamically generates instructions that include a summary of indexed tools grouped by server, helping Claude route queries to the correct tool source.

**Constants** (`src/constants.ts`):
- `DEFAULT_INDEX_PATH`: `.please/mcp/index.json`
- `DEFAULT_SEARCH_MODE`: `bm25`
- `DEFAULT_EMBEDDING_PROVIDER`: `local:minilm`

Uses `@modelcontextprotocol/sdk` for MCP protocol implementation with stdio transport.

## Environment Variables

```bash
OPENAI_API_KEY=sk-...    # For OpenAI embedding provider
VOYAGE_API_KEY=pa-...    # For Voyage embedding provider
```
