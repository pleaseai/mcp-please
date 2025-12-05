/**
 * Tool deduplication utilities for multi-scope index operations
 */

import type { IndexedTool, PersistedIndex } from '@pleaseai/mcp-core'

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

  // Add user tools first (lower priority)
  if (userIndex) {
    for (const tool of userIndex.tools) {
      toolMap.set(tool.tool.name, tool)
    }
  }

  // Add project tools (higher priority, overwrites user)
  if (projectIndex) {
    for (const tool of projectIndex.tools) {
      toolMap.set(tool.tool.name, tool)
    }
  }

  return Array.from(toolMap.values())
}

/**
 * Merge BM25 stats from multiple indexes.
 * Prefers project stats, falls back to user stats.
 *
 * @param projectIndex - Project-level index (can be null)
 * @param userIndex - User-level index (can be null)
 * @returns Merged BM25Stats or default empty stats
 */
export function mergeBM25Stats(
  projectIndex: PersistedIndex | null,
  userIndex: PersistedIndex | null,
): { avgDocLength: number, documentFrequencies: Record<string, number>, totalDocuments: number } {
  // Prefer project stats, fall back to user stats
  const baseStats = projectIndex?.bm25Stats ?? userIndex?.bm25Stats

  if (!baseStats) {
    return {
      avgDocLength: 0,
      documentFrequencies: {},
      totalDocuments: 0,
    }
  }

  return baseStats
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
