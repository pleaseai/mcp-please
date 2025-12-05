/**
 * Index path resolution utilities for scope-based index storage
 */

import type { IndexScope } from '../types/index-scope.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const INDEX_FILENAME = 'index.json'
const PLEASE_MCP_DIR = '.please/mcp'

/**
 * Get index file path based on scope.
 * Follows the same pattern as getConfigPath() in config-fingerprint.ts
 *
 * @param scope - Index scope ('project' or 'user')
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Absolute path to the index file
 */
export function getIndexPath(scope: IndexScope, cwd: string = process.cwd()): string {
  const home = homedir()

  switch (scope) {
    case 'user':
      return join(home, PLEASE_MCP_DIR, INDEX_FILENAME)
    case 'project':
    default:
      return join(cwd, PLEASE_MCP_DIR, INDEX_FILENAME)
  }
}

/**
 * Get all index paths for 'all' scope operations.
 * Returns paths in priority order (project first, then user).
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of scope-path pairs in priority order
 */
export function getAllIndexPaths(cwd?: string): { scope: IndexScope, path: string }[] {
  return [
    { scope: 'project', path: getIndexPath('project', cwd) },
    { scope: 'user', path: getIndexPath('user', cwd) },
  ]
}

/**
 * Detect scope from a given index path.
 * Used for backward compatibility with legacy single-scope indexes.
 *
 * @param indexPath - Path to the index file
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Detected scope ('user' if matches user path, 'project' otherwise)
 */
export function detectScopeFromPath(indexPath: string, cwd?: string): IndexScope {
  const userPath = getIndexPath('user', cwd)
  return indexPath === userPath ? 'user' : 'project'
}
