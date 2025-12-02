import type { EmbeddingProviderType } from '@pleaseai/mcp-core'
import process from 'node:process'
import {
  createEmbeddingProvider,
  IndexManager,
} from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH } from '../constants.js'
import { error, info, success } from '../utils/output.js'

/**
 * Create the index command
 */
export function createIndexCommand(): Command {
  const cmd = new Command('index')
    .description('Build search index from tool definitions')
    .argument('<sources...>', 'Paths to JSON/YAML files or directories')
    .option('-o, --output <path>', 'Output path for index file', DEFAULT_INDEX_PATH)
    .option(
      '-p, --provider <type>',
      'Embedding provider: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .option('-m, --model <name>', 'Embedding model name')
    .option('--no-embeddings', 'Skip embedding generation')
    .option('-f, --force', 'Overwrite existing index')
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

        // Build index
        spinner.text = 'Building index...'

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

        // Save index
        spinner.text = 'Saving index...'
        await indexManager.saveIndex(indexedTools, options.output)

        spinner.succeed(`Indexed ${indexedTools.length} tools`)
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
