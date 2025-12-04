#!/usr/bin/env node

import process from 'node:process'
import { Command } from 'commander'
import { createCallCommand } from './commands/call.js'
import { createIndexCommand } from './commands/index-cmd.js'
import { createInstallCommand } from './commands/install.js'
import { createMcpCommand } from './commands/mcp.js'
import { createSearchCommand } from './commands/search.js'
import { createServeCommand } from './commands/serve.js'

const program = new Command()

program
  .name('pleaseai-mcp')
  .description('MCP server and CLI for searching tools using regex, BM25, or semantic search')
  .version('1.0.0')

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
  await program.parseAsync(['node', 'pleaseai-mcp', ...args])
})

// Parse arguments
program.parse()
