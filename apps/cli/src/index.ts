#!/usr/bin/env node

import { Command } from 'commander'
import { createIndexCommand } from './commands/index-cmd.js'
import { createSearchCommand } from './commands/search.js'
import { createServeCommand } from './commands/serve.js'

const program = new Command()

program
  .name('mcp-search')
  .description('MCP server and CLI for searching tools using regex, BM25, or semantic search')
  .version('1.0.0')

// Add commands
program.addCommand(createIndexCommand())
program.addCommand(createSearchCommand())
program.addCommand(createServeCommand())

// Parse arguments
program.parse()
