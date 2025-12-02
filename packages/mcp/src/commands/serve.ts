import type { EmbeddingProviderType, SearchMode } from '@pleaseai/mcp-core'
import process from 'node:process'
import { createEmbeddingProvider, IndexManager } from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH, DEFAULT_SEARCH_MODE } from '../constants.js'
import { McpToolSearchServer } from '../server.js'
import { ensurePleaseGitignore } from '../utils/gitignore.js'
import { buildAndSaveIndex, indexNeedsRebuild } from '../utils/indexer.js'
import { error, info, success, warn } from '../utils/output.js'

/**
 * Create the serve command
 */
export function createServeCommand(): Command {
  const cmd = new Command('serve')
    .description('Start MCP server with tool_search capability')
    .option('-t, --transport <type>', 'Transport type: stdio | http', 'stdio')
    .option('-p, --port <number>', 'HTTP port (only for http transport)', '3000')
    .option('-i, --index <path>', 'Path to index file', DEFAULT_INDEX_PATH)
    .option('-m, --mode <mode>', 'Default search mode: regex | bm25 | embedding', DEFAULT_SEARCH_MODE)
    .option(
      '--provider <type>',
      'Embedding provider: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .option('--auto-index', 'Automatically index tools from MCP servers on startup')
    .option('--no-embeddings', 'Skip embedding generation during auto-indexing')
    .option('--timeout <ms>', 'Timeout for MCP server connections during auto-indexing', '30000')
    .option('--exclude <servers>', 'Comma-separated list of server names to exclude from auto-indexing')
    .action(async (options) => {
      const spinner = ora('Starting MCP server...').start()

      try {
        const transport = options.transport as 'stdio' | 'http'
        const port = Number.parseInt(options.port, 10)
        const defaultMode = options.mode as SearchMode
        const providerType = options.provider as EmbeddingProviderType
        const indexPath = options.index as string
        const autoIndex = options.autoIndex === true
        const generateEmbeddings = options.embeddings !== false
        const timeout = Number.parseInt(options.timeout, 10)
        const excludeServers = options.exclude ? (options.exclude as string).split(',').map((s: string) => s.trim()) : []

        // Auto-index if enabled and index needs rebuild
        if (autoIndex) {
          const needsRebuild = await indexNeedsRebuild(indexPath)

          if (needsRebuild) {
            spinner.text = 'Auto-indexing tools from MCP servers...'

            try {
              const result = await buildAndSaveIndex({
                outputPath: indexPath,
                embeddingProvider: generateEmbeddings ? providerType : undefined,
                generateEmbeddings,
                timeout,
                excludeServers,
                force: true,
                onProgress: (message) => {
                  spinner.text = message
                },
                onServerProgress: (serverName, status) => {
                  if (status === 'connecting') {
                    spinner.text = `Connecting to ${serverName}...`
                  }
                },
                onWarning: (message) => {
                  warn(message)
                },
                onInfo: (message) => {
                  info(message)
                },
              })

              // Ensure index directory is gitignored
              ensurePleaseGitignore(['mcp.local.json', 'mcp/'])

              success(`Auto-indexed ${result.indexedTools.length} tools`)
              info(`Embeddings: ${result.hasEmbeddings ? 'Yes' : 'No'}`)
            }
            catch (indexErr) {
              warn(`Auto-indexing failed: ${indexErr instanceof Error ? indexErr.message : String(indexErr)}`)
              warn('Server will start with empty or existing index.')
            }
          }
          else {
            info('Index already exists, skipping auto-indexing.')
          }
        }
        else {
          // Ensure index file exists (original behavior)
          const indexManager = new IndexManager()
          const indexCreated = await indexManager.ensureIndexExists(indexPath)
          if (indexCreated) {
            warn(`Created empty index at: ${indexPath}`)
            warn('Run `npx @pleaseai/mcp index` to add tools, or use --auto-index flag.')
          }
        }

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
