/**
 * Tool deduplication utilities for multi-scope index operations
 */

import type { IndexedTool, PersistedIndex } from '@pleaseai/mcp-core'
import process from 'node:process'

/** Enable debug logging via environment variable */
const DEBUG = process.env.MCP_GATEWAY_DEBUG === 'true'

/**
 * Merge tools from multiple indexes with deduplication.
 * Project scope tools override user scope tools with the same name.
 *
 * @param projectIndex - Project-level index (higher priority, can be null)
 * @param userIndex - User-level index (lower priority, can be null)
 * @returns Merged array of IndexedTool with duplicates removed
 */
export function mergeIndexedTools(
  projectIndex: PersistedIndex | null,
  userIndex: PersistedIndex | null,
): IndexedTool[] {
  const toolMap = new Map<string, IndexedTool>()
  let overrideCount = 0

  // Add user tools first (lower priority)
  if (userIndex) {
    for (const tool of userIndex.tools) {
      toolMap.set(tool.tool.name, tool)
    }
  }

  // Add project tools (higher priority, overwrites user)
  if (projectIndex) {
    for (const tool of projectIndex.tools) {
      if (DEBUG && toolMap.has(tool.tool.name)) {
        console.error(`[DEBUG] Tool '${tool.tool.name}' from project overrides user version`)
        overrideCount++
      }
      toolMap.set(tool.tool.name, tool)
    }
  }

  if (DEBUG && overrideCount > 0) {
    console.error(`[DEBUG] Merged indexes: ${overrideCount} tool(s) overridden by project scope`)
  }

  return Array.from(toolMap.values())
}

/**
 * Merge BM25 stats from multiple indexes.
 * Combines totalDocuments, avgDocLength, and documentFrequencies for accurate
 * BM25 search scores when searching across both project and user scopes.
 *
 * @param projectIndex - Project-level index (can be null)
 * @param userIndex - User-level index (can be null)
 * @returns Merged BM25Stats or default empty stats
 */
export function mergeBM25Stats(
  projectIndex: PersistedIndex | null,
  userIndex: PersistedIndex | null,
): { avgDocLength: number, documentFrequencies: Record<string, number>, totalDocuments: number } {
  const pStats = projectIndex?.bm25Stats
  const uStats = userIndex?.bm25Stats

  if (!pStats && !uStats) {
    return { avgDocLength: 0, documentFrequencies: {}, totalDocuments: 0 }
  }
  if (!pStats) {
    return uStats!
  }
  if (!uStats) {
    return pStats
  }

  // Combine statistics from both indexes
  const totalDocuments = pStats.totalDocuments + uStats.totalDocuments
  const totalLength = pStats.avgDocLength * pStats.totalDocuments + uStats.avgDocLength * uStats.totalDocuments
  const avgDocLength = totalDocuments > 0 ? totalLength / totalDocuments : 0

  // Merge document frequencies
  const documentFrequencies: Record<string, number> = { ...pStats.documentFrequencies }
  for (const [term, freq] of Object.entries(uStats.documentFrequencies)) {
    documentFrequencies[term] = (documentFrequencies[term] || 0) + freq
  }

  return {
    totalDocuments,
    avgDocLength,
    documentFrequencies,
  }
}

/**
 * Check if any of the provided indexes have embeddings
 *
 * @param projectIndex - Project-level index (can be null)
 * @param userIndex - User-level index (can be null)
 * @returns true if any index has embeddings
 */
export function hasAnyEmbeddings(
  projectIndex: PersistedIndex | null,
  userIndex: PersistedIndex | null,
): boolean {
  return (projectIndex?.hasEmbeddings ?? false) || (userIndex?.hasEmbeddings ?? false)
}
