# MCP Gateway

[![npm version](https://img.shields.io/npm/v/@pleaseai/mcp-gateway.svg)](https://www.npmjs.com/package/@pleaseai/mcp-gateway)
[![npm version](https://img.shields.io/npm/v/@pleaseai/mcp-core.svg)](https://www.npmjs.com/package/@pleaseai/mcp-core)
[![codecov](https://codecov.io/gh/pleaseai/mcp-gateway/graph/badge.svg)](https://codecov.io/gh/pleaseai/mcp-gateway)
[![code style](https://antfu.me/badge-code-style.svg)](https://github.com/antfu/eslint-config)

MCP server and CLI for searching MCP tools using **regex**, **BM25**, **semantic (embedding)**, or **hybrid** search.

## Monorepo Structure

```
mcp-gateway/
├── packages/
│   ├── core/                # Core search engine (@pleaseai/mcp-core)
│   └── mcp/                 # CLI + MCP server (@pleaseai/mcp-gateway)
├── turbo.json               # Turbo build configuration
└── package.json             # Root workspace configuration
```

## Features

- **Multiple Search Modes**:
  - **Regex**: Pattern matching on tool names and descriptions
  - **BM25**: Traditional text search ranking algorithm
  - **Embedding**: Semantic search using vector similarity
  - **Hybrid**: Combined BM25 + Embedding with Reciprocal Rank Fusion (RRF)

- **Configurable Embedding Providers**:
  - **local:minilm**: all-MiniLM-L6-v2 via transformers.js (384 dims, no API key required)
  - **local:mdbr-leaf**: MongoDB MDBR-Leaf-IR (256 dims, optimized for search)
  - **api:openai**: OpenAI Embeddings API
  - **api:voyage**: Voyage AI embeddings

- **Tool Sources**:
  - Load tool definitions from JSON/YAML files
  - Auto-discover tools from configured MCP servers
  - OAuth 2.1 authentication support for remote MCP servers

- **MCP Server**: Full MCP protocol implementation with:
  - `search_tools` - Search indexed tools
  - `get_tool` - Get detailed tool schema with CLI usage template
  - `tool_search_info` / `list_tools` - Index metadata

- **IDE Integration**: Install command for multiple IDEs

## Installation

### Claude Code Plugin

```bash
# Add the marketplace
/plugin marketplace add pleaseai/claude-code-plugins

# Install the plugin
/plugin install mcp-gateway@pleaseai
```

### Homebrew (macOS/Linux)

```bash
brew install pleaseai/tap/mcp-gateway
```

### Shell Script

```bash
curl -fsSL https://raw.githubusercontent.com/pleaseai/mcp-gateway/main/install.sh | bash
```

> **Security Note**: Piping `curl` to `bash` executes remote code without inspection. For added security, you can download and inspect the script first:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/pleaseai/mcp-gateway/main/install.sh -o install.sh
> # ... inspect install.sh ...
> bash install.sh
> ```

### npm/npx

```bash
# Using npx (no install required)
npx @pleaseai/mcp-gateway index <tool-sources>
npx @pleaseai/mcp-gateway search "query"
npx @pleaseai/mcp-gateway serve

# Global install
npm install -g @pleaseai/mcp-gateway
```

### Development Setup

```bash
bun install
bun run build
```

## CLI Usage

### Index Tools

Build a search index from tool definitions or MCP servers:

```bash
# Index from configured MCP servers (reads from .please/mcp.json)
npx @pleaseai/mcp-gateway index

# Index from specific JSON/YAML files
npx @pleaseai/mcp-gateway index tools.json

# Index without embeddings (faster, BM25/regex only)
npx @pleaseai/mcp-gateway index --no-embeddings

# Index with local embeddings (default: local:minilm)
npx @pleaseai/mcp-gateway index

# Index with specific provider
npx @pleaseai/mcp-gateway index -p local:mdbr-leaf
npx @pleaseai/mcp-gateway index -p api:openai

# Exclude specific MCP servers
npx @pleaseai/mcp-gateway index --exclude server1,server2

# Custom output path (default: .please/mcp/index.json)
npx @pleaseai/mcp-gateway index -o ./my-index.json

# Force overwrite existing index
npx @pleaseai/mcp-gateway index -f
```

### Search Tools

Search for tools in the index:

```bash
# BM25 search (default)
npx @pleaseai/mcp-gateway search "file operations"

# Regex search
npx @pleaseai/mcp-gateway search "read.*file" --mode regex

# Semantic search
npx @pleaseai/mcp-gateway search "tools for sending messages" --mode embedding

# Hybrid search (BM25 + Embedding with RRF)
npx @pleaseai/mcp-gateway search "file management tools" --mode hybrid

# Limit results
npx @pleaseai/mcp-gateway search "database" -k 5

# JSON output
npx @pleaseai/mcp-gateway search "database" --format json
```

### Start MCP Server

Start the MCP server for tool search:

```bash
# Default (stdio transport, reads from .please/mcp/index.json)
npx @pleaseai/mcp-gateway serve

# Or just (serve is the default command)
npx @pleaseai/mcp-gateway

# Specify index path
npx @pleaseai/mcp-gateway serve -i ./data/index.json

# Set default search mode
npx @pleaseai/mcp-gateway serve -m embedding
```

### Install to IDE

Install MCP server configuration to your IDE:

```bash
# Claude Code (default, creates .mcp.json)
npx @pleaseai/mcp-gateway install

# Claude Desktop
npx @pleaseai/mcp-gateway install --ide claude-desktop

# Cursor
npx @pleaseai/mcp-gateway install --ide cursor

# VS Code
npx @pleaseai/mcp-gateway install --ide vscode

# Gemini CLI
npx @pleaseai/mcp-gateway install --ide gemini

# OpenAI Codex
npx @pleaseai/mcp-gateway install --ide codex

# Preview without writing
npx @pleaseai/mcp-gateway install --dry-run
```

### Manage MCP Servers

Manage MCP server configurations (similar to `claude mcp` command):

```bash
# Add a stdio server (default scope: local)
npx @pleaseai/mcp-gateway mcp add my-server npx -- @some/mcp-server --option value

# Add an HTTP server
npx @pleaseai/mcp-gateway mcp add notion --transport http https://mcp.notion.com/mcp

# Add with environment variables
npx @pleaseai/mcp-gateway mcp add my-server npx @some/mcp -e API_KEY=xxx -e DEBUG=true

# Add to specific scope
npx @pleaseai/mcp-gateway mcp add my-server npx @some/mcp --scope project
npx @pleaseai/mcp-gateway mcp add my-server npx @some/mcp --scope user

# List all configured servers
npx @pleaseai/mcp-gateway mcp list
npx @pleaseai/mcp-gateway mcp ls --format json

# Get server details
npx @pleaseai/mcp-gateway mcp get my-server

# Remove a server
npx @pleaseai/mcp-gateway mcp remove my-server
npx @pleaseai/mcp-gateway mcp rm my-server --scope project
```

**Configuration Scopes:**

| Scope | Path | Purpose |
|-------|------|---------|
| `local` (default) | `.please/mcp.local.json` | Local overrides, gitignored |
| `project` | `.please/mcp.json` | Project-wide, committed to git |
| `user` | `~/.please/mcp.json` | User-wide settings |

**Scope Details:**

- **`local`**: Personal configuration that should not be shared. Automatically added to `.please/.gitignore`. Use for API keys, local paths, or experimental servers.
- **`project`**: Shared configuration for the team. Commit to git so all team members use the same MCP servers.
- **`user`**: Global configuration across all projects. Useful for personal MCP servers you want available everywhere.

**Scope Resolution Order:**

When multiple scopes define the same server, they are merged with the following priority (highest first):
1. `local` - Local overrides take precedence
2. `project` - Project settings override user settings
3. `user` - Base configuration

This allows you to define team-wide servers in `project` scope while overriding specific settings (like API keys) in `local` scope.

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
- Search strategies (Regex, BM25, Embedding, Hybrid)
- Embedding providers (Local MiniLM, Local MDBR-Leaf, OpenAI, Voyage AI)
- Index management (loader, builder, storage)

### @pleaseai/mcp-gateway

CLI + MCP server exposing:
- `index` - Build search index from tool definitions or MCP servers
- `search` - Search for tools
- `serve` - Start MCP server (default command)
- `install` - Install to IDE configuration
- `mcp` - Manage MCP server configurations

MCP tools:
- `search_tools` - Search with query, mode, top_k, threshold
- `get_tool` - Get detailed tool schema, metadata, and CLI usage template
- `tool_search_info` - Get index metadata
- `list_tools` - List all indexed tools with pagination

## MCP Server Tools

### `search_tools`

Search for tools using regex, BM25, semantic, or hybrid search. Returns matching tools ranked by relevance.

**Parameters:**
- `query` (string, required): Search query string
- `mode` (string, optional): Search mode - `regex`, `bm25`, `embedding`, or `hybrid` (default: `bm25`)
- `top_k` (number, optional): Maximum results to return (default: 10)
- `threshold` (number, optional): Minimum score threshold 0-1 (default: 0)

### `get_tool`

Get detailed information about a specific tool including its input schema and CLI usage template.

**Parameters:**
- `name` (string, required): Tool name from search results

**Response:**
- `name`: Full tool name (format: `server__toolName`)
- `description`: What the tool does
- `requiredFields`: Array of required parameter names
- `parameters`: Array of all parameters with name, type, required flag, and description
- `inputSchema`: Complete JSON Schema for validation
- `cliUsage`: CLI command template for executing via Bash tool

**Recommended Workflow:** `search_tools` → `get_tool` → (use `cliUsage` via Bash tool)

> **Why CLI instead of MCP `call_tool`?**
>
> Using the CLI via Bash tool enables proper permission checks by the host application (e.g., Claude Code).
> When tools are executed through the CLI, the host can verify user consent before running potentially
> sensitive operations. Direct MCP `call_tool` bypasses these permission checks, which may be undesirable
> in environments where user approval is required for tool execution.

### `tool_search_info`

Get information about the tool search index.

### `list_tools`

List all tools in the index with pagination.

**Parameters:**
- `limit` (number, optional): Maximum tools to return (default: 100)
- `offset` (number, optional): Pagination offset (default: 0)

### Call Tool via CLI

Execute discovered tools using the CLI command provided by `get_tool`:

```bash
# Basic usage (command template from get_tool response)
mcp-gateway call <server>__<tool> --param1 "value1" --param2 "value2"

# Example: Call a file read tool
mcp-gateway call filesystem__read_file --path "/tmp/example.txt"

# With JSON arguments for complex parameters
mcp-gateway call myserver__create_item --data '{"name": "test", "count": 5}'
```

The `cliUsage` field in `get_tool` response provides a ready-to-use command template.

## OAuth Authentication

MCP Gateway supports OAuth 2.1 authentication for remote MCP servers that require it.

### How it works

1. When indexing or calling tools on an OAuth-protected server, the CLI will automatically detect the authentication requirement
2. A browser window opens for you to complete the OAuth flow
3. Tokens are securely stored in `~/.please/oauth/` for future use
4. Token refresh is handled automatically

### Supported flows

- Authorization Code with PKCE (recommended)
- Token refresh for long-lived sessions

### Token storage

OAuth tokens are stored per-server in `~/.please/oauth/<server-name>.json`. These files are automatically managed and should not be edited manually.

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

## Documentation

- [Search Architecture](./docs/search-architecture.md) - How the search engine works (strategies, indexing, no vector DB)
- [Embedding Model Comparison](./docs/embedding-models.md) - Benchmark results and recommendations for local embedding models

## References

- [Tool Search Tool - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Advanced Tool Use - Anthropic Engineering](https://www.anthropic.com/engineering/advanced-tool-use)
- [Tool Search with Embeddings - Claude Cookbook](https://github.com/anthropics/claude-cookbooks/blob/main/tool_use/tool_search_with_embeddings.ipynb)
- [Implement Tool Use - Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#providing-tool-use-examples)

## License

MIT
