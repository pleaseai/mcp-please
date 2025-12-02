import type { EmbeddingProviderType, SearchMode } from '@pleaseai/mcp-core'
import process from 'node:process'
import { createEmbeddingProvider } from '@pleaseai/mcp-core'
import { McpToolSearchServer } from '@pleaseai/mcp-server'
import { Command } from 'commander'
import ora from 'ora'
import { error, info } from '../utils/output.js'

/**
 * Create the serve command
 */
export function createServeCommand(): Command {
  const cmd = new Command('serve')
    .description('Start MCP server with tool_search capability')
    .option('-t, --transport <type>', 'Transport type: stdio | http', 'stdio')
    .option('-p, --port <number>', 'HTTP port (only for http transport)', '3000')
    .option('-i, --index <path>', 'Path to index file', './data/index.json')
    .option('-m, --mode <mode>', 'Default search mode: regex | bm25 | embedding', 'bm25')
    .option(
      '--provider <type>',
      'Embedding provider: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      'local:minilm',
    )
    .action(async (options) => {
      const spinner = ora('Starting MCP server...').start()

      try {
        const transport = options.transport as 'stdio' | 'http'
        const port = Number.parseInt(options.port, 10)
        const defaultMode = options.mode as SearchMode
        const providerType = options.provider as EmbeddingProviderType

        // Create embedding provider
        const embeddingProvider = createEmbeddingProvider({
          type: providerType,
        })

        // Create server
        const server = new McpToolSearchServer({
          transport,
          port,
          indexPath: options.index,
          defaultMode,
          embeddingProvider: {
            type: providerType,
          },
        })

        server.setEmbeddingProvider(embeddingProvider)

        // Start server
        spinner.text = 'Initializing server...'
        await server.start(transport)

        spinner.succeed('MCP server started')
        info(`Transport: ${transport}`)
        info(`Index: ${options.index}`)
        info(`Default mode: ${defaultMode}`)

        if (transport === 'http') {
          info(`Port: ${port}`)
        }
        else {
          info('Listening on stdio...')
        }

        // Keep process alive for stdio
        if (transport === 'stdio') {
          // Server handles stdin/stdout, just keep alive
          process.on('SIGINT', async () => {
            info('Shutting down...')
            await server.stop()
            process.exit(0)
          })
        }
      }
      catch (err) {
        spinner.fail('Failed to start server')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
