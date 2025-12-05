/**
 * Configuration file fingerprinting for index regeneration detection
 */

import type { ConfigFingerprint } from '@pleaseai/mcp-core'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export type ScopeType = 'local' | 'project' | 'user'

/**
 * Get config file path based on scope
 */
export function getConfigPath(scope: ScopeType, cwd: string = process.cwd()): string {
  const home = homedir()

  switch (scope) {
    case 'project':
      return join(cwd, '.please', 'mcp.json')
    case 'user':
      return join(home, '.please', 'mcp.json')
    case 'local':
    default:
      return join(cwd, '.please', 'mcp.local.json')
  }
}

/**
 * Create fingerprint for a single config file.
 *
 * @param filePath - Absolute path to the config file
 * @returns ConfigFingerprint with `exists: true` if file is readable,
 *          or `exists: false` if file is missing or unreadable.
 *          File read errors are logged to stderr for debugging.
 */
export function createConfigFingerprint(filePath: string): ConfigFingerprint {
  if (!existsSync(filePath)) {
    return { exists: false }
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const hash = createHash('sha256').update(content).digest('hex')
    return { exists: true, hash }
  }
  catch (err) {
    // Log error but return exists: false to allow graceful degradation
    // This can happen with permission errors, file locks, etc.
    console.error(`Warning: Cannot read config file ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
    return { exists: false }
  }
}

/**
 * Create fingerprints for all config scopes
 */
export function createAllConfigFingerprints(cwd?: string): {
  local?: ConfigFingerprint
  project?: ConfigFingerprint
  user?: ConfigFingerprint
} {
  return {
    local: createConfigFingerprint(getConfigPath('local', cwd)),
    project: createConfigFingerprint(getConfigPath('project', cwd)),
    user: createConfigFingerprint(getConfigPath('user', cwd)),
  }
}

/**
 * Get CLI version from package.json.
 *
 * Looks for package.json in the following order:
 * 1. Relative to the compiled module (dist/ -> package root)
 * 2. Current working directory (fallback for development)
 *
 * @returns Version string or 'unknown' if not found
 */
export function getCliVersion(): string {
  try {
    // Get the directory of the current module
    const currentDir = fileURLToPath(new URL('.', import.meta.url))

    // tsup bundles to flat dist/ directory (dist/cli.js, not dist/utils/...)
    // So we only need to go up one level: dist/ -> package root
    const packageJsonPath = join(currentDir, '..', 'package.json')

    if (existsSync(packageJsonPath)) {
      const content = readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content) as { version?: string }
      if (pkg.version) {
        return pkg.version
      }
      console.error(`Warning: package.json at ${packageJsonPath} missing version field`)
    }

    // Fallback: try relative to current working directory (for development)
    const cwdPackagePath = join(process.cwd(), 'package.json')
    if (existsSync(cwdPackagePath)) {
      const content = readFileSync(cwdPackagePath, 'utf-8')
      const pkg = JSON.parse(content) as { version?: string }
      if (pkg.version) {
        return pkg.version
      }
    }

    console.error('Warning: Could not determine CLI version - package.json not found')
    return 'unknown'
  }
  catch (err) {
    console.error(`Warning: Failed to determine CLI version: ${err instanceof Error ? err.message : String(err)}`)
    return 'unknown'
  }
}
