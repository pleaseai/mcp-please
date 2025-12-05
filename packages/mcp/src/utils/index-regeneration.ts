/**
 * Index regeneration detection
 * Determines when the search index needs to be rebuilt
 */

import type { PersistedIndex } from '@pleaseai/mcp-core'
import { existsSync } from 'node:fs'
import { IndexStorage } from '@pleaseai/mcp-core'
import { createAllConfigFingerprints, getCliVersion } from './config-fingerprint.js'

export interface RegenerationResult {
  needsRebuild: boolean
  reasons: string[]
}

export interface CurrentArgs {
  mode?: string
  provider?: string
  dtype?: string
}

/**
 * Check if the index needs to be regenerated
 *
 * Conditions for regeneration:
 * 1. Index file missing
 * 2. Index file corrupted or invalid
 * 3. Legacy index (no build metadata)
 * 4. CLI version changed
 * 5. CLI args changed (mode, provider, dtype)
 * 6. Config file added/removed/modified
 *
 * Note: The `exclude` option is only available in `index` command.
 * If you need to change which servers are excluded, run `mcp-gateway index` manually.
 */
export async function checkIndexRegeneration(
  indexPath: string,
  currentArgs: CurrentArgs,
  cwd?: string,
): Promise<RegenerationResult> {
  const reasons: string[] = []

  // Condition 1: Index file missing
  if (!existsSync(indexPath)) {
    return { needsRebuild: true, reasons: ['Index file not found'] }
  }

  // Load existing index
  const storage = new IndexStorage()
  let index: PersistedIndex

  try {
    index = await storage.load(indexPath)
  }
  catch (err) {
    // Condition 2: Index corrupted or invalid - include actual error for debugging
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { needsRebuild: true, reasons: [`Index file corrupted or invalid: ${errorMessage}`] }
  }

  // Condition 3: Legacy index without build metadata
  if (!index.buildMetadata) {
    return { needsRebuild: true, reasons: ['Index missing build metadata (legacy format)'] }
  }

  // Condition 4: CLI version changed
  const currentVersion = getCliVersion()
  if (index.buildMetadata.cliVersion !== currentVersion) {
    reasons.push(`CLI version changed: ${index.buildMetadata.cliVersion} → ${currentVersion}`)
  }

  // Condition 5: CLI args changed
  const storedArgs = index.buildMetadata.cliArgs

  if (storedArgs.mode !== currentArgs.mode) {
    reasons.push(`Search mode changed: ${storedArgs.mode || 'default'} → ${currentArgs.mode || 'default'}`)
  }
  if (storedArgs.provider !== currentArgs.provider) {
    reasons.push(`Embedding provider changed: ${storedArgs.provider || 'default'} → ${currentArgs.provider || 'default'}`)
  }
  if (storedArgs.dtype !== currentArgs.dtype) {
    reasons.push(`Model dtype changed: ${storedArgs.dtype || 'default'} → ${currentArgs.dtype || 'default'}`)
  }

  // Condition 6: Config files changed
  const currentFingerprints = createAllConfigFingerprints(cwd)
  const storedFingerprints = index.buildMetadata.configFingerprints

  for (const scope of ['local', 'project', 'user'] as const) {
    const current = currentFingerprints[scope]
    const stored = storedFingerprints[scope]

    // Handle missing fingerprint in stored data
    const storedExists = stored?.exists ?? false
    const currentExists = current?.exists ?? false

    if (currentExists !== storedExists) {
      reasons.push(`Config ${scope}: ${storedExists ? 'removed' : 'added'}`)
    }
    else if (current?.exists && stored?.exists && current.hash !== stored.hash) {
      // Both exist - compare hashes (TypeScript now knows hash is defined due to discriminated union)
      reasons.push(`Config ${scope}: content changed`)
    }
  }

  return {
    needsRebuild: reasons.length > 0,
    reasons,
  }
}
