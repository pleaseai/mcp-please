import type { EmbeddingProviderType, ModelDtype, ToolDefinition } from '@pleaseai/mcp-core'
import process from 'node:process'
import {
  createEmbeddingProvider,
  IndexBuilder,
  IndexManager,
} from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH } from '../constants.js'
import { getAllMcpServers, loadToolsFromMcpServers } from '../utils/mcp-config-loader.js'
import { error, info, success, warn } from '../utils/output.js'

/**
 * Create the index command
 */
export function createIndexCommand(): Command {
  const cmd = new Command('index')
    .description('Build search index from MCP servers or tool definition files')
    .argument('[sources...]', 'Paths to JSON/YAML files (optional, uses MCP config if not provided)')
    .option('-o, --output <path>', 'Output path for index file', DEFAULT_INDEX_PATH)
    .option(
      '-p, --provider <type>',
      'Embedding provider: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .option('-m, --model <name>', 'Embedding model name')
    .option(
      '-d, --dtype <type>',
      'Model dtype: fp32 | fp16 | q8 | q4 | q4f16 (default: fp32)',
      'fp32',
    )
    .option('--no-embeddings', 'Skip embedding generation')
    .option('-f, --force', 'Overwrite existing index')
    .option('--exclude <servers>', 'Comma-separated list of MCP servers to exclude')
    .action(async (sources: string[], options) => {
      const spinner = ora('Loading tools...').start()

      try {
        // Create index manager
        const indexManager = new IndexManager()
        const indexBuilder = new IndexBuilder()

        // Setup embedding provider if needed
        if (options.embeddings) {
          const providerType = options.provider as EmbeddingProviderType
          const dtype = options.dtype as ModelDtype

          spinner.text = `Initializing ${providerType} embedding provider...`

          const provider = createEmbeddingProvider({
            type: providerType,
            model: options.model,
            dtype,
          })

          await provider.initialize()
          indexManager.setEmbeddingProvider(provider)

          info(`Using ${providerType} embeddings (${provider.dimensions} dimensions)`)
        }

        // Check if index exists
        if (!options.force) {
          const exists = await indexManager.indexExists(options.output)
          if (exists) {
            spinner.fail(`Index already exists at ${options.output}. Use --force to overwrite.`)
            process.exit(1)
          }
        }

        let tools: ToolDefinition[] = []

        // If no sources provided, load from MCP servers
        if (!sources || sources.length === 0) {
          const allServers = getAllMcpServers()

          if (allServers.size === 0) {
            spinner.fail('No MCP servers configured. Add servers with: mcp-search mcp add')
            process.exit(1)
          }

          spinner.text = `Loading tools from ${allServers.size} MCP server(s)...`

          const exclude = options.exclude ? options.exclude.split(',').map((s: string) => s.trim()) : undefined

          tools = await loadToolsFromMcpServers({
            exclude,
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
                case 'error':
                  break
              }
            },
            onError: (serverName, err) => {
              warn(`${serverName}: ${err.message}`)
            },
          })
        }
        else {
          // Load from file sources
          spinner.text = 'Building index from files...'

          const indexedTools = await indexManager.buildIndex(sources, {
            generateEmbeddings: options.embeddings,
            onProgress: (current, total, toolName) => {
              spinner.text = `Processing ${current}/${total}: ${toolName}`
            },
          })

          if (indexedTools.length === 0) {
            spinner.fail('No tools found in the provided sources.')
            process.exit(1)
          }

          // Save index and exit (file-based flow)
          spinner.text = 'Saving index...'
          await indexManager.saveIndex(indexedTools, options.output)

          spinner.succeed(`Indexed ${indexedTools.length} tools`)
          success(`Index saved to ${options.output}`)

          const hasEmbeddings = indexedTools.some(t => t.embedding && t.embedding.length > 0)
          info(`Embeddings: ${hasEmbeddings ? 'Yes' : 'No'}`)
          return
        }

        if (tools.length === 0) {
          spinner.fail('No tools found from MCP servers.')
          process.exit(1)
        }

        // Build index from MCP tools
        spinner.text = 'Building index...'
        const indexedTools = indexBuilder.buildIndex(tools)

        // Generate embeddings if requested using IndexManager's centralized method
        if (options.embeddings && indexManager.getEmbeddingProvider()) {
          const total = indexedTools.length
          await indexManager.generateEmbeddingsFor(indexedTools, (current, _total, _toolName) => {
            spinner.text = `Generating embeddings: ${current}/${total}`
          })
        }

        // Save index
        spinner.text = 'Saving index...'
        await indexManager.saveIndex(indexedTools, options.output)

        spinner.succeed(`Indexed ${indexedTools.length} tools from MCP servers`)
        success(`Index saved to ${options.output}`)

        // Show stats
        const hasEmbeddings = indexedTools.some(t => t.embedding && t.embedding.length > 0)
        info(`Embeddings: ${hasEmbeddings ? 'Yes' : 'No'}`)
      }
      catch (err) {
        spinner.fail('Indexing failed')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
