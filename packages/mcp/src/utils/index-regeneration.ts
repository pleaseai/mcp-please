/**
 * Index regeneration detection
 * Determines when the search index needs to be rebuilt
 */

import type { PersistedIndex } from '@pleaseai/mcp-core'
import { existsSync } from 'node:fs'
import { IndexStorage } from '@pleaseai/mcp-core'
import { createAllConfigFingerprints, getCliVersion, getConfigFingerprintsForScope } from './config-fingerprint.js'

export interface RegenerationResult {
  needsRebuild: boolean
  reasons: string[]
}

export interface CurrentArgs {
  mode?: string
  provider?: string
  dtype?: string
  exclude?: string[]
}

export interface RegenerationOptions {
  cwd?: string
  /** Index scope for scope-aware fingerprint checking */
  scope?: 'project' | 'user'
}

/**
 * Check if the index needs to be regenerated
 *
 * Conditions for regeneration:
 * 1. Index file missing
 * 2. Index file corrupted or invalid
 * 3. Legacy index (no build metadata)
 * 4. CLI version changed
 * 5. CLI args changed (mode, provider, dtype, exclude)
 * 6. Config file added/removed/modified
 *
 * @param indexPath - Path to the index file
 * @param currentArgs - Current CLI arguments
 * @param optionsOrCwd - Either a RegenerationOptions object or a cwd string (backward compatible)
 */
export async function checkIndexRegeneration(
  indexPath: string,
  currentArgs: CurrentArgs,
  optionsOrCwd?: RegenerationOptions | string,
): Promise<RegenerationResult> {
  // Handle backward compatibility: third arg can be string (cwd) or options object
  const options: RegenerationOptions | undefined = typeof optionsOrCwd === 'string'
    ? { cwd: optionsOrCwd }
    : optionsOrCwd

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

  // Compare sorted exclude arrays to handle order differences
  const storedExclude = (storedArgs.exclude ?? []).slice().sort()
  const currentExclude = (currentArgs.exclude ?? []).slice().sort()
  if (JSON.stringify(storedExclude) !== JSON.stringify(currentExclude)) {
    reasons.push(
      `Excluded servers changed: ${storedArgs.exclude?.join(', ') || 'none'} → ${currentArgs.exclude?.join(', ') || 'none'}`,
    )
  }

  // Condition 6: Config files changed
  // Use scope-aware fingerprints if scope is specified
  const currentFingerprints = options?.scope
    ? getConfigFingerprintsForScope(options.scope, options?.cwd)
    : createAllConfigFingerprints(options?.cwd)
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
