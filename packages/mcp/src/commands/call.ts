/**
 * CLI Call Command
 * Execute a tool on an MCP server via CLI for permission-checkable tool calls
 */

import type { CallOutputFormat } from '../utils/output.js'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { IndexManager } from '@pleaseai/mcp-core'
import { Command, Option } from 'commander'
import { DEFAULT_INDEX_PATH } from '../constants.js'
import { createToolExecutor } from '../services/tool-executor.js'
import { error, formatCallError, formatCallResult } from '../utils/output.js'

/**
 * Read all data from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  try {
    for await (const chunk of process.stdin) {
      chunks.push(chunk)
    }
  }
  catch (err) {
    throw new Error(`Failed to read stdin: ${err instanceof Error ? err.message : String(err)}`)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Parse JSON arguments with helpful error messages
 */
function parseArgs(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString)
  }
  catch (err) {
    throw new Error(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Execute a tool directly without the 'call' subcommand
 * This enables permission-based tool execution patterns like:
 *   mcp-gateway asana__get_tasks --args '{}'
 *
 * @param toolName - Tool name in format server__toolName
 * @param argv - Remaining arguments (--args, --format, etc.)
 *
 * @example
 * // Direct execution for permission-checkable calls
 * mcp-gateway github__get_issue --args '{"owner":"org","repo":"repo","issue_number":123}'
 *
 * // Permission pattern in settings: "Bash(mcp-gateway github__*:*)"
 */
export function executeToolDirect(toolName: string, argv: string[]): void {
  // Parse options manually
  let args: Record<string, unknown> = {}
  let indexPath = DEFAULT_INDEX_PATH
  let format: CallOutputFormat = 'json'

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-a' || arg === '--args') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) {
        error('--args requires a JSON argument value')
        process.exit(1)
      }
      try {
        args = parseArgs(argv[++i])
      }
      catch (err) {
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    }
    else if (arg === '-i' || arg === '--index') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) {
        error('--index requires a path value')
        process.exit(1)
      }
      indexPath = argv[++i]
    }
    else if (arg === '-f' || arg === '--format') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) {
        error('--format requires a value (json or minimal)')
        process.exit(1)
      }
      const formatValue = argv[++i]
      if (formatValue !== 'json' && formatValue !== 'minimal') {
        error(`Invalid format '${formatValue}'. Valid formats are: json, minimal`)
        process.exit(1)
      }
      format = formatValue
    }
  }

  // Execute tool with proper error handling for async operation
  executeCall(toolName, args, indexPath, format).catch((err) => {
    error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}

/**
 * Core tool execution logic shared by both call command and direct execution
 */
async function executeCall(
  toolName: string,
  args: Record<string, unknown>,
  indexPath: string,
  format: CallOutputFormat,
): Promise<void> {
  const indexManager = new IndexManager()
  const executor = createToolExecutor({
    getIndex: () => indexManager.loadIndex(indexPath),
  })

  const result = await executor.execute(toolName, args)

  if (result.success) {
    console.log(formatCallResult(result, format))
    if (result.result.isError) {
      process.exit(1)
    }
  }
  else {
    throw new Error(formatCallError(result, format))
  }
}

/**
 * Create the call command (legacy, kept for backward compatibility)
 *
 * @example
 * // Using --args flag
 * mcp-gateway call "github__get_issue" --args '{"owner":"org","repo":"repo","issue_number":123}'
 *
 * @example
 * // Using stdin pipe
 * echo '{"owner":"org","repo":"repo","issue_number":123}' | mcp-gateway call "github__get_issue"
 *
 * @example
 * // With different output format
 * mcp-gateway call "tool_name" --args '{}' --format minimal
 *
 * @example
 * // Preferred: Direct tool execution (enables permission-based patterns)
 * mcp-gateway github__get_issue --args '{"owner":"org","repo":"repo","issue_number":123}'
 */
export function createCallCommand(): Command {
  const cmd = new Command('call')
    .description('Call a tool on an MCP server (prefer direct execution: mcp-gateway tool_name --args)')
    .argument('<tool_name>', 'Tool name (format: server__toolName)')
    .option('-a, --args <json>', 'Tool arguments as JSON string')
    .option('-i, --index <path>', 'Path to index file', DEFAULT_INDEX_PATH)
    .addOption(new Option('-f, --format <format>', 'Output format: json | minimal').choices(['json', 'minimal']).default('json'))
    .action(async (toolName: string, options) => {
      try {
        // Parse arguments from --args flag or stdin
        let args: Record<string, unknown> = {}

        if (options.args) {
          args = parseArgs(options.args)
        }
        else if (!process.stdin.isTTY) {
          // Read from stdin if not a TTY (i.e., data is being piped)
          const stdinData = await readStdin()
          if (stdinData.trim()) {
            args = parseArgs(stdinData)
          }
        }

        await executeCall(toolName, args, options.index, options.format as CallOutputFormat)
      }
      catch (err) {
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
