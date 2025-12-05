import type { EmbeddingProviderType, IndexedTool, PersistedIndex, SearchMode } from '@pleaseai/mcp-core'
import type { CliScope } from '../types/index-scope.js'
import type { OutputFormat } from '../utils/output.js'
import process from 'node:process'
import {
  createEmbeddingProvider,
  IndexManager,
  SearchOrchestrator,
} from '@pleaseai/mcp-core'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_CLI_SCOPE, DEFAULT_EMBEDDING_PROVIDER, DEFAULT_INDEX_PATH, DEFAULT_SEARCH_MODE, DEFAULT_TOP_K } from '../constants.js'
import { CLI_SCOPES, isCliScope } from '../types/index-scope.js'
import { getIndexPath } from '../utils/index-paths.js'
import { error, formatSearchResults, info, warn } from '../utils/output.js'
import { hasAnyEmbeddings, mergeBM25Stats, mergeIndexedTools } from '../utils/tool-deduplication.js'

/**
 * Check if an error indicates the file does not exist (ENOENT)
 */
function isFileNotFoundError(err: unknown): boolean {
  if (err instanceof Error && 'code' in err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
  if (err instanceof Error) {
    return err.message.includes('ENOENT') || err.message.includes('no such file')
  }
  return false
}

/**
 * Create the search command
 */
export function createSearchCommand(): Command {
  const cmd = new Command('search')
    .description('Search for tools in the index')
    .argument('<query>', 'Search query string')
    .option('-m, --mode <mode>', 'Search mode: regex | bm25 | embedding | hybrid', DEFAULT_SEARCH_MODE)
    .option('-k, --top-k <number>', 'Number of results to return', String(DEFAULT_TOP_K))
    .option('-t, --threshold <number>', 'Minimum score threshold (0-1)', '0')
    .option('-i, --index <path>', 'Path to index file', DEFAULT_INDEX_PATH)
    .option('-f, --format <format>', 'Output format: table | json | minimal', 'table')
    .option(
      '-p, --provider <type>',
      'Embedding provider for semantic search: local:minilm | local:mdbr-leaf | api:openai | api:voyage',
      DEFAULT_EMBEDDING_PROVIDER,
    )
    .option('-s, --scope <scope>', 'Search scope: project | user | all', DEFAULT_CLI_SCOPE)
    .action(async (query: string, options) => {
      const spinner = ora('Loading index...').start()

      try {
        const mode = options.mode as SearchMode
        const topK = Number.parseInt(options.topK, 10)
        const threshold = Number.parseFloat(options.threshold)
        const format = options.format as OutputFormat
        const scope = options.scope as CliScope

        // Validate scope option
        if (!isCliScope(scope)) {
          spinner.fail(`Invalid scope: "${scope}"`)
          error(`Valid options: ${CLI_SCOPES.join(', ')}`)
          process.exit(1)
        }

        // Load index(es) based on scope
        const indexManager = new IndexManager()
        let tools: IndexedTool[]
        let bm25Stats: { avgDocLength: number, documentFrequencies: Record<string, number>, totalDocuments: number }
        let hasEmbeddings = false

        // If a custom index path is provided, use it directly (ignore scope)
        const customIndexPath = options.index !== DEFAULT_INDEX_PATH ? options.index : null

        if (customIndexPath) {
          // User provided explicit path - use it directly
          const index = await indexManager.loadIndex(customIndexPath)
          tools = index.tools
          bm25Stats = index.bm25Stats
          hasEmbeddings = index.hasEmbeddings
        }
        else if (scope === 'all') {
          // Load both indexes and merge
          const projectPath = getIndexPath('project')
          const userPath = getIndexPath('user')

          let projectIndex: PersistedIndex | null = null
          let userIndex: PersistedIndex | null = null
          let projectLoadFailed = false
          let userLoadFailed = false

          try {
            projectIndex = await indexManager.loadIndex(projectPath)
          }
          catch (err) {
            if (!isFileNotFoundError(err)) {
              warn(`Failed to load project index at ${projectPath}: ${err instanceof Error ? err.message : err}`)
              projectLoadFailed = true
            }
          }

          try {
            userIndex = await indexManager.loadIndex(userPath)
          }
          catch (err) {
            if (!isFileNotFoundError(err)) {
              warn(`Failed to load user index at ${userPath}: ${err instanceof Error ? err.message : err}`)
              userLoadFailed = true
            }
          }

          if (!projectIndex && !userIndex) {
            spinner.fail('No indexes found')
            error(`Checked:\n  - Project: ${projectPath}${projectLoadFailed ? ' (load failed)' : ''}\n  - User: ${userPath}${userLoadFailed ? ' (load failed)' : ''}`)
            error('Create an index first with: mcp-gateway index')
            process.exit(1)
          }

          tools = mergeIndexedTools(projectIndex, userIndex)
          bm25Stats = mergeBM25Stats(projectIndex, userIndex)
          hasEmbeddings = hasAnyEmbeddings(projectIndex, userIndex)

          const scopeInfo = []
          if (projectIndex)
            scopeInfo.push(`project: ${projectIndex.tools.length}`)
          if (userIndex)
            scopeInfo.push(`user: ${userIndex.tools.length}`)
          info(`Loaded indexes: ${scopeInfo.join(', ')} → ${tools.length} unique tools`)
        }
        else {
          // Load single scope
          const indexPath = getIndexPath(scope)

          const index = await indexManager.loadIndex(indexPath)
          tools = index.tools
          bm25Stats = index.bm25Stats
          hasEmbeddings = index.hasEmbeddings
        }

        // Create search orchestrator
        const orchestrator = new SearchOrchestrator({
          defaultMode: mode,
          defaultTopK: topK,
        })

        // Set BM25 stats
        orchestrator.setBM25Stats(bm25Stats)

        // Setup embedding provider for semantic search (embedding and hybrid modes)
        if (mode === 'embedding' || mode === 'hybrid') {
          if (!hasEmbeddings) {
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
          tools,
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
