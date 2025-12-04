import type { EmbeddingProviderType, ModelDtype, SearchMode } from '@pleaseai/mcp-core'
import fs from 'node:fs'
import process from 'node:process'
import { createEmbeddingProvider, IndexBuilder, IndexManager } from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH, DEFAULT_SEARCH_MODE } from '../constants.js'
import { McpToolSearchServer } from '../server.js'
import { getAllMcpServers, loadToolsFromMcpServers } from '../utils/mcp-config-loader.js'
import { error, info, warn } from '../utils/output.js'

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
    .option(
      '--dtype <type>',
      'Model dtype: fp32 | fp16 | q8 | q4 | q4f16 (default: fp32)',
      'fp32',
    )
    .action(async (options) => {
      const spinner = ora('Starting MCP server...').start()

      try {
        // Validate dtype option
        const VALID_DTYPES = ['fp32', 'fp16', 'q8', 'q4', 'q4f16'] as const
        if (!VALID_DTYPES.includes(options.dtype)) {
          spinner.fail(`Invalid dtype: "${options.dtype}"`)
          error(`Valid options: ${VALID_DTYPES.join(', ')}`)
          process.exit(1)
        }

        const transport = options.transport as 'stdio' | 'http'
        const port = Number.parseInt(options.port, 10)
        const defaultMode = options.mode as SearchMode
        const providerType = options.provider as EmbeddingProviderType
        const dtype = options.dtype as ModelDtype
        const indexPath = options.index as string

        // Warn if dtype is specified with API providers
        if (providerType.startsWith('api:') && dtype !== 'fp32') {
          warn(`dtype "${dtype}" is ignored for API providers (only applies to local providers)`)
        }

        // Check if index exists, if not create it automatically
        if (!fs.existsSync(indexPath)) {
          spinner.text = 'Index not found, creating from MCP servers...'

          const allServers = getAllMcpServers()

          if (allServers.size === 0) {
            spinner.fail('No index found and no MCP servers configured.')
            error('Create an index first with: mcp-gateway index <sources>')
            error('Or add MCP servers with: mcp-gateway mcp add')
            process.exit(1)
          }

          const indexManager = new IndexManager()
          const indexBuilder = new IndexBuilder()

          // Setup embedding provider if using embedding mode
          let autoIndexEmbeddingProvider = null
          if (defaultMode === 'embedding') {
            autoIndexEmbeddingProvider = createEmbeddingProvider({ type: providerType, dtype })
            await autoIndexEmbeddingProvider.initialize()
            indexManager.setEmbeddingProvider(autoIndexEmbeddingProvider)
          }

          // Load tools from MCP servers
          const tools = await loadToolsFromMcpServers({
            onProgress: (serverName, status, toolCount) => {
              switch (status) {
                case 'connecting':
                  spinner.text = `Connecting to ${serverName}...`
                  break
                case 'authenticating':
                  spinner.text = `Authenticating ${serverName}...`
                  break
                case 'fetching':
                  spinner.text = `Fetching tools from ${serverName}...`
                  break
                case 'done':
                  info(`${serverName}: ${toolCount} tools`)
                  break
              }
            },
            onError: (serverName, err) => {
              warn(`${serverName}: ${err.message}`)
            },
          })

          if (tools.length === 0) {
            spinner.fail('No tools found from MCP servers.')
            process.exit(1)
          }

          // Build index
          spinner.text = 'Building index...'
          const indexedTools = indexBuilder.buildIndex(tools)

          // Generate embeddings if using embedding mode using IndexManager's centralized method
          if (defaultMode === 'embedding' && indexManager.getEmbeddingProvider()) {
            const total = indexedTools.length
            await indexManager.generateEmbeddingsFor(indexedTools, (current, _total, _toolName) => {
              spinner.text = `Generating embeddings: ${current}/${total}`
            })
          }

          // Save index
          await indexManager.saveIndex(indexedTools, indexPath)
          info(`Auto-indexed ${indexedTools.length} tools`)
        }

        // Create embedding provider
        const embeddingProvider = createEmbeddingProvider({
          type: providerType,
          dtype,
        })

        // Create server
        const server = new McpToolSearchServer({
          transport,
          port,
          indexPath,
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
