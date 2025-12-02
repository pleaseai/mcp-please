# MCP Tool Search

MCP server and CLI for searching MCP tools using **regex**, **BM25**, or **semantic (embedding)** search.

## Monorepo Structure

```
mcp-search/
├── packages/
│   ├── core/                # Core search engine (@pleaseai/mcp-core)
│   └── mcp/                 # CLI + MCP server (@pleaseai/mcp)
├── turbo.json               # Turbo build configuration
└── package.json             # Root workspace configuration
```

## Features

- **Multiple Search Modes**:
  - **Regex**: Pattern matching on tool names and descriptions
  - **BM25**: Traditional text search ranking algorithm
  - **Embedding**: Semantic search using vector similarity

- **Configurable Embedding Providers**:
  - **local:minilm**: all-MiniLM-L6-v2 via transformers.js (384 dims, no API key required)
  - **local:mdbr-leaf**: MongoDB MDBR-Leaf-IR (256 dims, optimized for search)
  - **api:openai**: OpenAI Embeddings API
  - **api:voyage**: Voyage AI embeddings

- **Tool Source**: Load tool definitions from JSON/YAML files

- **MCP Server**: Expose `tool_search` capability via MCP protocol

- **IDE Integration**: Install command for multiple IDEs

## Installation

```bash
# Using npm/npx (recommended)
npx @pleaseai/mcp index <tool-sources>
npx @pleaseai/mcp search "query"
npx @pleaseai/mcp serve

# Development setup
bun install
bun run build
```

## CLI Usage

### Index Tools

Build a search index from tool definitions:

```bash
# Index without embeddings (faster, BM25/regex only)
npx @pleaseai/mcp index tools.json --no-embeddings

# Index with local embeddings (default: local:minilm)
npx @pleaseai/mcp index tools.json

# Index with specific provider
npx @pleaseai/mcp index tools.json -p local:mdbr-leaf
npx @pleaseai/mcp index tools.json -p api:openai

# Custom output path (default: .please/mcp/index.json)
npx @pleaseai/mcp index tools.json -o ./my-index.json

# Force overwrite existing index
npx @pleaseai/mcp index tools.json -f
```

### Search Tools

Search for tools in the index:

```bash
# BM25 search (default)
npx @pleaseai/mcp search "file operations"

# Regex search
npx @pleaseai/mcp search "read.*file" --mode regex

# Semantic search
npx @pleaseai/mcp search "tools for sending messages" --mode embedding

# Limit results
npx @pleaseai/mcp search "database" -k 5

# JSON output
npx @pleaseai/mcp search "database" --format json
```

### Start MCP Server

Start the MCP server for tool search:

```bash
# Default (stdio transport, reads from .please/mcp/index.json)
npx @pleaseai/mcp serve

# Or just (serve is the default command)
npx @pleaseai/mcp

# Specify index path
npx @pleaseai/mcp serve -i ./data/index.json

# Set default search mode
npx @pleaseai/mcp serve -m embedding
```

### Install to IDE

Install MCP server configuration to your IDE:

```bash
# Claude Code (default, creates .mcp.json)
npx @pleaseai/mcp install

# Claude Desktop
npx @pleaseai/mcp install --ide claude-desktop

# Cursor
npx @pleaseai/mcp install --ide cursor

# VS Code
npx @pleaseai/mcp install --ide vscode

# Gemini CLI
npx @pleaseai/mcp install --ide gemini

# OpenAI Codex
npx @pleaseai/mcp install --ide codex

# Preview without writing
npx @pleaseai/mcp install --dry-run
```

### Manage MCP Servers

Manage MCP server configurations (similar to `claude mcp` command):

```bash
# Add a stdio server (default scope: local)
npx @pleaseai/mcp mcp add my-server npx -- @some/mcp-server --option value

# Add an HTTP server
npx @pleaseai/mcp mcp add notion --transport http https://mcp.notion.com/mcp

# Add with environment variables
npx @pleaseai/mcp mcp add my-server npx @some/mcp -e API_KEY=xxx -e DEBUG=true

# Add to specific scope
npx @pleaseai/mcp mcp add my-server npx @some/mcp --scope project
npx @pleaseai/mcp mcp add my-server npx @some/mcp --scope user

# List all configured servers
npx @pleaseai/mcp mcp list
npx @pleaseai/mcp mcp ls --format json

# Get server details
npx @pleaseai/mcp mcp get my-server

# Remove a server
npx @pleaseai/mcp mcp remove my-server
npx @pleaseai/mcp mcp rm my-server --scope project
```

**Configuration Scopes:**

| Scope | Path | Purpose |
|-------|------|---------|
| `local` (default) | `.please/mcp.local.json` | Local overrides, gitignored |
| `project` | `.please/mcp.json` | Project-wide, committed to git |
| `user` | `~/.please/mcp.json` | User-wide settings |

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Build specific package
bun run build --filter=@pleaseai/mcp-core

# Development mode (watch)
bun run dev

# Run tests
bun run test

# Type check
bun run typecheck

# Clean build artifacts
bun run clean
```

## Packages

### @pleaseai/mcp-core

Core search engine with:
- Search strategies (Regex, BM25, Embedding)
- Embedding providers (Local MiniLM, Local MDBR-Leaf, OpenAI, Voyage AI)
- Index management (loader, builder, storage)

### @pleaseai/mcp

CLI + MCP server exposing:
- `index` - Build search index from tool definitions
- `search` - Search for tools
- `serve` - Start MCP server (default command)
- `install` - Install to IDE configuration
- `mcp` - Manage MCP server configurations

MCP tools:
- `tool_search` - Search with query, mode, top_k, threshold
- `tool_search_info` - Get index metadata
- `tool_search_list` - List all indexed tools

## MCP Server Tools

### `tool_search`

Search for tools using regex, BM25, or semantic search.

**Parameters:**
- `query` (string, required): Search query string
- `mode` (string, optional): Search mode - `regex`, `bm25`, or `embedding` (default: `bm25`)
- `top_k` (number, optional): Maximum results to return (default: 10)
- `threshold` (number, optional): Minimum score threshold 0-1 (default: 0)

### `tool_search_info`

Get information about the tool search index.

### `tool_search_list`

List all tools in the index.

**Parameters:**
- `limit` (number, optional): Maximum tools to return (default: 100)
- `offset` (number, optional): Pagination offset (default: 0)

## Configuration

### Default Paths

- **Index file**: `.please/mcp/index.json`
- **Search mode**: `bm25`
- **Embedding provider**: `local:minilm`

### Environment Variables

```bash
# OpenAI API Key (for api:openai embedding provider)
OPENAI_API_KEY=sk-...

# Voyage AI API Key (for api:voyage embedding provider)
VOYAGE_API_KEY=pa-...
```

### IDE Config Locations

| IDE | Config Path |
|-----|-------------|
| Claude Code | `.mcp.json` (project root) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor | `.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| OpenAI Codex | `~/.codex/config.toml` |

## Tool Definition Format

Tool definitions follow the MCP tool specification:

```json
{
  "tools": [
    {
      "name": "read_file",
      "title": "Read File",
      "description": "Read the contents of a file from the filesystem",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "The path to the file to read"
          }
        },
        "required": ["path"]
      }
    }
  ]
}
```

## License

MIT
