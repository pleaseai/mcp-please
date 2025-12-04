#!/usr/bin/env node

import process from 'node:process'
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { createCallCommand, executeToolDirect } from './commands/call.js'
import { createIndexCommand } from './commands/index-cmd.js'
import { createInstallCommand } from './commands/install.js'
import { createMcpCommand } from './commands/mcp.js'
import { createSearchCommand } from './commands/search.js'
import { createServeCommand } from './commands/serve.js'

const program = new Command()

program
  .name('mcp-gateway')
  .description('MCP server and CLI for searching tools using regex, BM25, or semantic search')
  .version(pkg.version)

// Known subcommands
const KNOWN_COMMANDS = new Set(['index', 'search', 'call', 'serve', 'install', 'mcp', 'help', '-h', '--help', '-V', '--version'])

// Add commands
program.addCommand(createIndexCommand())
program.addCommand(createSearchCommand())
program.addCommand(createCallCommand())
program.addCommand(createServeCommand())
program.addCommand(createInstallCommand())
program.addCommand(createMcpCommand())

// Default action: run serve command if no subcommand provided
program.action(async () => {
  // Re-parse with serve command
  const args = ['serve', ...process.argv.slice(2)]
  await program.parseAsync(['node', 'mcp-gateway', ...args])
})

// Check if first argument is a tool name (contains '__')
const firstArg = process.argv[2]
if (firstArg && firstArg.includes('__') && !KNOWN_COMMANDS.has(firstArg)) {
  // Direct tool execution: mcp-gateway server__tool --args '{}'
  executeToolDirect(firstArg, process.argv.slice(3))
}
else {
  // Parse arguments normally
  program.parse()
}
