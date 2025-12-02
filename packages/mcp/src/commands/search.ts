import type { EmbeddingProviderType, SearchMode } from '@pleaseai/mcp-core'
import type { OutputFormat } from '../utils/output.js'
import process from 'node:process'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH, DEFAULT_SEARCH_MODE, DEFAULT_TOP_K } from '../constants.js'
import { error, formatSearchResults } from '../utils/output.js'

/**
 * Create the search command
 */
export function createSearchCommand(): Command {
  const cmd = new Command('search')
    .description('Search for tools in the index')
    .argument('<query>', 'Search query string')
    .option('-m, --mode <mode>', 'Search mode: regex | bm25 | embedding', DEFAULT_SEARCH_MODE)
    .option('-k, --top-k <number>', 'Number of results to return', String(DEFAULT_TOP_K))
    .option('-t, --threshold <number>', 'Minimum score threshold (0-1)', '0')
    .option('-i, --index <path>', 'Path to index file', DEFAULT_INDEX_PATH)
    .option('-f, --format <format>', 'Output format: table | json | minimal', 'table')
    .option(
      '-p, --provider <type>',
      'Embedding provider for semantic search: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .action(async (query: string, options) => {
      const spinner = ora('Loading index...').start()

      try {
        const mode = options.mode as SearchMode
        const topK = Number.parseInt(options.topK, 10)
        const threshold = Number.parseFloat(options.threshold)
        const format = options.format as OutputFormat

        // Load index
        const indexManager = new IndexManager()
        const index = await indexManager.loadIndex(options.index)

        // Create search orchestrator
        const orchestrator = new SearchOrchestrator({
          defaultMode: mode,
          defaultTopK: topK,
        })

        // Set BM25 stats
        orchestrator.setBM25Stats(index.bm25Stats)

        // Setup embedding provider for semantic search
        if (mode === 'embedding') {
          if (!index.hasEmbeddings) {
            spinner.fail('Index does not contain embeddings. Re-index with embeddings enabled.')
            process.exit(1)
          }

          spinner.text = 'Initializing embedding provider...'

          const providerType = options.provider as EmbeddingProviderType
          const provider = createEmbeddingProvider({
            type: providerType,
          })

          await provider.initialize()
          orchestrator.setEmbeddingProvider(provider)
        }

        // Search
        spinner.text = 'Searching...'

        const result = await orchestrator.search(
          {
            query,
            mode,
            topK,
            threshold: threshold > 0 ? threshold : undefined,
          },
          index.tools,
        )

        spinner.stop()

        // Output results
        console.log(formatSearchResults(result, format))

        // Cleanup
        await orchestrator.dispose()
      }
      catch (err) {
        spinner.fail('Search failed')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
