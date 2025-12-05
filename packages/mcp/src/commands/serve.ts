import type { EmbeddingProviderType, ModelDtype, SearchMode } from '@pleaseai/mcp-core'
import type { CliScope, IndexScope } from '../types/index-scope.js'
import process from 'node:process'
import { createEmbeddingProvider, IndexBuilder, IndexManager } from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_CLI_SCOPE, DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH, DEFAULT_SEARCH_MODE } from '../constants.js'
import { McpToolSearchServer } from '../server.js'
import { getCliVersion, getConfigFingerprintsForScope } from '../utils/config-fingerprint.js'
import { getIndexPath } from '../utils/index-paths.js'
import { checkIndexRegeneration } from '../utils/index-regeneration.js'
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
    .option('-s, --scope <scope>', 'Index scope: project | user | all', DEFAULT_CLI_SCOPE)
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
        const scope = options.scope as CliScope

        // Validate scope option
        const VALID_SCOPES = ['project', 'user', 'all'] as const
        if (!VALID_SCOPES.includes(scope)) {
          spinner.fail(`Invalid scope: "${scope}"`)
          error(`Valid options: ${VALID_SCOPES.join(', ')}`)
          process.exit(1)
        }

        // Warn if dtype is specified with API providers
        if (providerType.startsWith('api:') && dtype !== 'fp32') {
          warn(`dtype "${dtype}" is ignored for API providers (only applies to local providers)`)
        }

        // Determine which scopes to check for regeneration
        const scopesToCheck: IndexScope[] = scope === 'all'
          ? ['project', 'user']
          : [scope]

        // Check and regenerate indexes per scope
        for (const currentScope of scopesToCheck) {
          const indexPath = getIndexPath(currentScope)

          const { needsRebuild, reasons } = await checkIndexRegeneration(
            indexPath,
            { mode: defaultMode, provider: providerType, dtype },
            { scope: currentScope },
          )

          if (needsRebuild) {
            spinner.text = `Index regeneration needed for ${currentScope} scope...`
            for (const reason of reasons) {
              info(`  - ${reason}`)
            }

            const allServers = getAllMcpServers(process.cwd(), currentScope)

            if (allServers.size === 0) {
              // No servers for this scope, skip silently for 'all' scope
              if (scope === 'all') {
                info(`No MCP servers configured for ${currentScope} scope, skipping`)
                continue
              }
              spinner.fail(`No index found and no MCP servers configured for ${currentScope} scope.`)
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

            // Load tools from MCP servers for this scope
            const tools = await loadToolsFromMcpServers({
              indexScope: currentScope,
              onProgress: (serverName, status, toolCount) => {
                switch (status) {
                  case 'connecting':
                    spinner.text = `[${currentScope}] Connecting to ${serverName}...`
                    break
                  case 'authenticating':
                    spinner.text = `[${currentScope}] Authenticating ${serverName}...`
                    break
                  case 'fetching':
                    spinner.text = `[${currentScope}] Fetching tools from ${serverName}...`
                    break
                  case 'done':
                    info(`[${currentScope}] ${serverName}: ${toolCount} tools`)
                    break
                }
              },
              onError: (serverName, err) => {
                warn(`[${currentScope}] ${serverName}: ${err.message}`)
              },
            })

            if (tools.length === 0) {
              if (scope === 'all') {
                info(`No tools found for ${currentScope} scope, skipping`)
                continue
              }
              spinner.fail(`No tools found from MCP servers for ${currentScope} scope.`)
              process.exit(1)
            }

            // Build index
            spinner.text = `Building ${currentScope} index...`
            const indexedTools = indexBuilder.buildIndex(tools)

            // Generate embeddings if using embedding mode using IndexManager's centralized method
            if (defaultMode === 'embedding' && indexManager.getEmbeddingProvider()) {
              const total = indexedTools.length
              await indexManager.generateEmbeddingsFor(indexedTools, (current, _total, _toolName) => {
                spinner.text = `Generating embeddings for ${currentScope}: ${current}/${total}`
              })
            }

            // Save index with build metadata for future regeneration detection
            await indexManager.saveIndex(indexedTools, indexPath, {
              buildMetadata: {
                cliVersion: getCliVersion(),
                cliArgs: { mode: defaultMode, provider: providerType, dtype, scope: currentScope },
                configFingerprints: getConfigFingerprintsForScope(currentScope),
              },
            })
            info(`Auto-indexed ${indexedTools.length} tools for ${currentScope} scope`)
          }
        }

        // Determine index paths for server
        let serverIndexPath: string
        let serverIndexPaths: string[] | undefined

        if (scope === 'all') {
          // Check which indexes exist
          const projectPath = getIndexPath('project')
          const userPath = getIndexPath('user')
          const indexManager = new IndexManager()

          let projectExists = false
          let userExists = false

          try {
            await indexManager.loadIndex(projectPath)
            projectExists = true
          }
          catch {
            // Doesn't exist
          }

          try {
            await indexManager.loadIndex(userPath)
            userExists = true
          }
          catch {
            // Doesn't exist
          }

          if (!projectExists && !userExists) {
            spinner.fail('No indexes found. Create an index first with: mcp-gateway index')
            process.exit(1)
          }

          if (projectExists && userExists) {
            serverIndexPaths = [projectPath, userPath]
            serverIndexPath = projectPath // Primary path for backward compatibility
          }
          else {
            serverIndexPath = projectExists ? projectPath : userPath
          }
        }
        else {
          serverIndexPath = options.index !== DEFAULT_INDEX_PATH
            ? options.index
            : getIndexPath(scope)
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
          indexPath: serverIndexPath,
          indexPaths: serverIndexPaths,
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
        info(`Scope: ${scope}`)
        if (serverIndexPaths) {
          info(`Indexes: ${serverIndexPaths.join(', ')}`)
        }
        else {
          info(`Index: ${serverIndexPath}`)
        }
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
