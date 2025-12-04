# Session Summary: Permission Check for call_tool

## Feature Description
Add a CLI `call` command that enables per-tool permission checks via Bash patterns, allowing Claude Code to enforce fine-grained permissions on individual MCP tool calls.

## Problem Statement
When Claude Code calls tools through the MCP gateway, permission check only happens at `call_tool` level. Once `mcp__pleaseai-mcp__call_tool` is in the allow list, ALL downstream tool calls bypass Claude Code's permission system:
- No per-tool permission control
- No PreToolUse hooks fired for individual tools
- No audit trail for which specific tools are being called

## Solution: CLI-Based Approach
```
claude code -> Bash(mcp-gateway call <tool>) -> [permission check] -> remote server
```

## Requirements Summary
1. Create `call` command (`packages/mcp/src/commands/call.ts`)
2. Register CLI command in `cli.ts`
3. Enhance `get_tool` response with `cliUsage` guidance
4. Add tests

### CLI Usage
```bash
# Option 1: --args flag
mcp-gateway call github__get_issue --args '{"owner":"org","repo":"repo","issue":123}'

# Option 2: stdin pipe
echo '{"owner":"org","repo":"repo","issue":123}' | mcp-gateway call github__get_issue
```

### Permission Configuration Example
```json
{
  "permissions": {
    "allow": [
      "Bash(mcp-gateway call github__get_issue:*)",
      "Bash(mcp-gateway call github__list_issues:*)"
    ],
    "deny": [
      "Bash(mcp-gateway call github__delete_*:*)"
    ]
  }
}
```

## Constraints and Limitations
- Must work with existing MCP infrastructure
- Must maintain backward compatibility with existing `call_tool` MCP method
- CLI must handle both --args flag and stdin input

## Files to Modify/Create
| File | Action | Description |
|------|--------|-------------|
| `packages/mcp/src/commands/call.ts` | CREATE | New call command implementation |
| `packages/mcp/src/cli.ts` | MODIFY | Register call command |
| `packages/mcp/src/server.ts` | MODIFY | Add cliUsage to get_tool response |
| `packages/mcp/src/commands/__tests__/call.test.ts` | CREATE | Tests for call command |

## Current Phase
**Phase 8: Complete** - Feature fully implemented and reviewed

## GitHub Workflow
- **Issue**: #6 (updated with detailed tasklist)
- **Branch**: `6-feat-add-permission-check-for-call_tool`
- **PR**: #20 - Ready for Review

## Implementation Summary
- Created `ToolExecutor` service for unified tool execution logic
- Added CLI `call` command with `--args` and stdin support
- Added `cliUsage` field to `get_tool` MCP response
- Added output formatters for call results
- Refactored server.ts call_tool to use ToolExecutor
- All 30 tests pass
- Build/typecheck/lint pass

## Quality Review Findings Addressed
- Added try-catch to stdin reader for proper error handling
- Constrained JsonSchemaProperty type to valid JSON schema types

## Phase 4: Architecture Design - Complete

## Chosen Architecture: Clean Architecture

### Design Decision
Extract a `ToolExecutor` service layer shared between CLI and MCP server.

### Components
1. **ToolExecutor Service** (`services/tool-executor.ts`)
   - Resolve tool from index by name
   - Resolve server configuration
   - Handle OAuth/bearer token retrieval
   - Execute tool via MCP client
   - Return typed result (success/error)

2. **CLI Call Command** (`commands/call.ts`)
   - Parse `--args` JSON or stdin
   - Initialize ToolExecutor with IndexManager
   - Format output (toon/json/minimal)
   - Handle errors with exit codes

3. **Output Formatters** (extend `utils/output.ts`)
   - `formatCallResult()` - format tool execution result
   - `formatCallError()` - format execution errors

4. **CLI Usage Generator** (`utils/cli-usage.ts`)
   - Generate `cliUsage` template string for `get_tool` response

### Files to Create/Modify
| File | Action | LOC |
|------|--------|-----|
| `packages/mcp/src/services/tool-executor.ts` | CREATE | ~120 |
| `packages/mcp/src/commands/call.ts` | CREATE | ~100 |
| `packages/mcp/src/utils/cli-usage.ts` | CREATE | ~40 |
| `packages/mcp/tests/call.test.ts` | CREATE | ~80 |
| `packages/mcp/src/cli.ts` | MODIFY | +2 |
| `packages/mcp/src/server.ts` | MODIFY | +20 |
| `packages/mcp/src/utils/output.ts` | MODIFY | +40 |

### Trade-offs
- (+) Better testability through service abstraction
- (+) DRY - no duplication between CLI and MCP handlers
- (+) Future extensibility (batch calls, timeouts, retries)
- (-) More code and abstractions to maintain

## Phase 3: Clarifying Questions - Complete

## Clarified Requirements
1. **Output Format**: Support toon/json/minimal via `--format` flag
2. **Error Handling**: Exit with non-zero code and print error to stderr
3. **cliUsage Format**: Template string with placeholders for arguments

## Phase 2: Codebase Exploration - Complete

## Codebase Patterns Found

### CLI Command Pattern
- Factory pattern: `createXxxCommand()` returns a `Command` instance
- All commands use `commander` library
- Consistent structure: `.description()` -> `.argument()` -> `.option()` -> `.action(async () => {})`
- Error handling: `ora` spinner + try/catch + `process.exit(1)`
- Output utilities: `success()`, `error()`, `warn()`, `info()` from `utils/output.ts`

### MCP Server Pattern
- `McpToolSearchServer` class in `server.ts`
- Tools registered via `this.server.registerTool()` with zod schemas
- Tool execution via `callToolOnMcpServer()` in `utils/mcp-client.ts`
- Index cached in `this.cachedIndex`
- Tool metadata: `metadata.server` (server name), `metadata.originalName` (original tool name)

### Tool Naming Convention
- Tools indexed with prefixed names: `serverName__toolName`
- Example: `github__create_issue`

### Key Files
| File | Purpose |
|------|---------|
| `packages/mcp/src/cli.ts` | CLI entry point, command registration |
| `packages/mcp/src/server.ts` | MCP server with tool registration |
| `packages/mcp/src/commands/search.ts` | Search command example |
| `packages/mcp/src/utils/mcp-client.ts` | MCP client for tool execution |
| `packages/mcp/src/utils/output.ts` | Output formatting utilities |
| `packages/mcp/src/constants.ts` | Default values |

### Key Abstractions
- `IndexManager` - Index loading/saving
- `SearchOrchestrator` - Search routing
- `callToolOnMcpServer()` - Tool execution on remote MCP servers

## Session Started
2025-12-04
