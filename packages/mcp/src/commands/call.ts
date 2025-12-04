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
 * Create the call command
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
 */
export function createCallCommand(): Command {
  const cmd = new Command('call')
    .description('Call a tool on an MCP server')
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

        const format = options.format as CallOutputFormat

        // Create tool executor with index loading
        const indexManager = new IndexManager()
        const executor = createToolExecutor({
          getIndex: () => indexManager.loadIndex(options.index),
        })

        // Execute tool
        const result = await executor.execute(toolName, args)

        // Output result
        if (result.success) {
          console.log(formatCallResult(result, format))

          // Exit with error code if tool returned isError
          if (result.result.isError) {
            process.exit(1)
          }
        }
        else {
          // Output error to stderr and exit with error code
          error(formatCallError(result, format))
          process.exit(1)
        }
      }
      catch (err) {
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
