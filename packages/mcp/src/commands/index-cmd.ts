import type { EmbeddingProviderType, ModelDtype } from '@pleaseai/mcp-core'
import type { McpConfig, MergedServerEntry } from '../utils/mcp-config.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  createEmbeddingProvider,
  IndexManager,
} from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH } from '../constants.js'
import { ensurePleaseGitignore } from '../utils/gitignore.js'
import { discoverToolsFromServers, flattenServerTools } from '../utils/mcp-client.js'
import { loadAllMcpServers } from '../utils/mcp-config.js'
import { error, info, success, warn } from '../utils/output.js'

/**
 * Load MCP config from a file path
 */
function loadMcpConfigFile(filePath: string): MergedServerEntry[] {
  const absolutePath = resolve(filePath)

  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`)
  }

  const content = readFileSync(absolutePath, 'utf-8')
  const config = JSON.parse(content) as McpConfig

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    return []
  }

  return Object.entries(config.mcpServers).map(([name, serverConfig]) => ({
    name,
    config: serverConfig,
    source: 'local' as const,
  }))
}

/**
 * Create the index command
 */
export function createIndexCommand(): Command {
  const cmd = new Command('index')
    .description('Build search index from MCP servers')
    .argument('[sources...]', 'Paths to MCP config files (optional, auto-discovers from .please/mcp.json if not provided)')
    .option('-o, --output <path>', 'Output path for index file', DEFAULT_INDEX_PATH)
    .option(
      '-p, --provider <type>',
      'Embedding provider: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .option('-m, --model <name>', 'Embedding model name')
    .option(
      '-d, --dtype <type>',
      'Model dtype for local providers: fp32 | fp16 | q8 | q4 | q4f16 (default: fp32)',
      'fp32',
    )
    .option('--no-embeddings', 'Skip embedding generation')
    .option('-f, --force', 'Overwrite existing index')
    .option('-t, --timeout <ms>', 'Timeout for MCP server connections', '30000')
    .option('--exclude <servers>', 'Comma-separated list of server names to exclude')
    .action(async (sources: string[], options) => {
      const spinner = ora('Loading tools...').start()

      try {
        // Create index manager
        const indexManager = new IndexManager()

        // Setup embedding provider if needed
        if (options.embeddings) {
          const providerType = options.provider as EmbeddingProviderType

          spinner.text = `Initializing ${providerType} embedding provider...`

          const provider = createEmbeddingProvider({
            type: providerType,
            model: options.model,
            dtype: options.dtype as ModelDtype,
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

        let servers: MergedServerEntry[] = []

        // If sources provided, load from config files
        if (sources.length > 0) {
          spinner.text = 'Loading MCP configurations from files...'

          for (const source of sources) {
            try {
              const fileServers = loadMcpConfigFile(source)
              servers.push(...fileServers)
              info(`Loaded ${fileServers.length} server(s) from ${source}`)
            }
            catch (err) {
              warn(`Failed to load ${source}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        }
        else {
          // Auto-discover from default MCP config locations
          spinner.text = 'Loading MCP server configurations...'
          servers = loadAllMcpServers()
        }

        if (servers.length === 0) {
          spinner.fail('No MCP servers found. Create .please/mcp.json or provide config files.')
          process.exit(1)
        }

        info(`Found ${servers.length} MCP server(s)`)

        const timeout = Number.parseInt(options.timeout, 10)
        const excludeServers = options.exclude ? (options.exclude as string).split(',').map((s: string) => s.trim()) : []

        spinner.text = 'Discovering tools from MCP servers...'
        const results = await discoverToolsFromServers(servers, {
          timeout,
          excludeServers,
          onProgress: (serverName, status) => {
            if (status === 'connecting') {
              spinner.text = `Connecting to ${serverName}...`
            }
            else if (status === 'done') {
              spinner.text = `${serverName}: done`
            }
            else if (status === 'error') {
              spinner.text = `${serverName}: failed`
            }
          },
        })

        // Report results
        for (const result of results) {
          if (result.error) {
            warn(`${result.serverName} (${result.source}): ${result.error}`)
          }
          else {
            info(`${result.serverName} (${result.source}): ${result.tools.length} tools`)
          }
        }

        const tools = flattenServerTools(results)

        if (tools.length === 0) {
          spinner.fail('No tools found from MCP servers.')
          process.exit(1)
        }

        // Build index from discovered tools
        spinner.text = 'Building index...'
        const { IndexBuilder } = await import('@pleaseai/mcp-core')
        const builder = new IndexBuilder()
        const builtIndex = builder.buildIndex(tools)

        // Generate embeddings if needed
        const embeddingProvider = indexManager.getEmbeddingProvider()
        if (options.embeddings && embeddingProvider) {
          const provider = embeddingProvider
          const batchSize = 32
          for (let i = 0; i < builtIndex.length; i += batchSize) {
            const batch = builtIndex.slice(i, i + batchSize)
            const texts = batch.map(t => t.searchableText)
            const embeddings = await provider.embedBatch(texts)
            for (let j = 0; j < batch.length; j++) {
              batch[j].embedding = embeddings[j]
              spinner.text = `Processing ${i + j + 1}/${builtIndex.length}: ${batch[j].tool.name}`
            }
          }
        }

        // Save index
        spinner.text = 'Saving index...'
        await indexManager.saveIndex(builtIndex, options.output)

        // Ensure index directory is gitignored
        ensurePleaseGitignore(['mcp.local.json', 'mcp/'])

        spinner.succeed(`Indexed ${builtIndex.length} tools`)
        success(`Index saved to ${options.output}`)

        const hasEmbeddings = builtIndex.some(t => t.embedding && t.embedding.length > 0)
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
