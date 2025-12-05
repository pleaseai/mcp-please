import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getCliVersion } from '../src/utils/config-fingerprint.js'
import { checkIndexRegeneration } from '../src/utils/index-regeneration.js'

describe('index-regeneration', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `index-regen-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('checkIndexRegeneration', () => {
    test('should require rebuild when index file is missing', async () => {
      const indexPath = join(testDir, 'missing-index.json')

      const result = await checkIndexRegeneration(indexPath, {})

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons).toContain('Index file not found')
    })

    test('should require rebuild when index file is corrupted', async () => {
      const indexPath = join(testDir, 'corrupted-index.json')
      writeFileSync(indexPath, 'not valid json {{{')

      const result = await checkIndexRegeneration(indexPath, {})

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.length).toBe(1)
      expect(result.reasons[0]).toContain('corrupted or invalid')
    })

    test('should require rebuild when index is legacy (no buildMetadata)', async () => {
      const indexPath = join(testDir, 'legacy-index.json')
      const legacyIndex = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTools: 0,
        hasEmbeddings: false,
        bm25Stats: {
          avgDocLength: 0,
          documentFrequencies: {},
          totalDocuments: 0,
        },
        tools: [],
        // No buildMetadata - legacy format
      }
      writeFileSync(indexPath, JSON.stringify(legacyIndex))

      const result = await checkIndexRegeneration(indexPath, {})

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons).toContain('Index missing build metadata (legacy format)')
    })

    test('should require rebuild when CLI version changed', async () => {
      const indexPath = join(testDir, 'version-changed.json')
      const index = createValidIndex({ cliVersion: '0.0.1' })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, {})

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('CLI version changed'))).toBe(true)
    })

    test('should require rebuild when search mode changed', async () => {
      const indexPath = join(testDir, 'mode-changed.json')
      const index = createValidIndex({ cliArgs: { mode: 'bm25' } })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, { mode: 'embedding' })

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Search mode changed'))).toBe(true)
    })

    test('should require rebuild when provider changed', async () => {
      const indexPath = join(testDir, 'provider-changed.json')
      const index = createValidIndex({ cliArgs: { provider: 'local:minilm' } })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, { provider: 'local:mdbr-leaf' })

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Embedding provider changed'))).toBe(true)
    })

    test('should require rebuild when dtype changed', async () => {
      const indexPath = join(testDir, 'dtype-changed.json')
      const index = createValidIndex({ cliArgs: { dtype: 'fp32' } })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, { dtype: 'fp16' })

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Model dtype changed'))).toBe(true)
    })

    test('should require rebuild when exclude list changed', async () => {
      const indexPath = join(testDir, 'exclude-changed.json')
      const index = createValidIndex({ cliArgs: { exclude: ['server-a'] } })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, { exclude: ['server-b'] })

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Excluded servers changed'))).toBe(true)
    })

    test('should not require rebuild when exclude list has same items in different order', async () => {
      const indexPath = join(testDir, 'exclude-same.json')
      const currentVersion = getCliVersion()
      const index = createValidIndex({
        cliVersion: currentVersion,
        cliArgs: { exclude: ['server-a', 'server-b'] },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(
        indexPath,
        { exclude: ['server-b', 'server-a'] },
        testDir,
      )

      expect(result.needsRebuild).toBe(false)
    })

    test('should not require rebuild when nothing changed', async () => {
      const indexPath = join(testDir, 'unchanged.json')
      const currentVersion = getCliVersion()
      const index = createValidIndex({
        cliVersion: currentVersion,
        cliArgs: { mode: 'bm25', provider: 'local:mdbr-leaf', dtype: 'fp32' },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(
        indexPath,
        { mode: 'bm25', provider: 'local:mdbr-leaf', dtype: 'fp32' },
        testDir,
      )

      expect(result.needsRebuild).toBe(false)
      expect(result.reasons).toEqual([])
    })

    test('should detect config file added', async () => {
      const indexPath = join(testDir, 'config-added.json')
      // Index was created without any config files
      const index = createValidIndex({
        configFingerprints: {
          local: { exists: false },
          project: { exists: false },
          user: { exists: false },
        },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      // Now create a project config
      const pleasePath = join(testDir, '.please')
      mkdirSync(pleasePath, { recursive: true })
      writeFileSync(join(pleasePath, 'mcp.json'), '{"mcpServers": {}}')

      const result = await checkIndexRegeneration(indexPath, {}, testDir)

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Config project: added'))).toBe(true)
    })

    test('should detect config file removed', async () => {
      const indexPath = join(testDir, 'config-removed.json')
      // Index was created with a project config
      const index = createValidIndex({
        configFingerprints: {
          local: { exists: false },
          project: { exists: true, hash: 'abc123' },
          user: { exists: false },
        },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      // No config files exist in testDir
      const result = await checkIndexRegeneration(indexPath, {}, testDir)

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Config project: removed'))).toBe(true)
    })

    test('should detect config file content changed', async () => {
      const pleasePath = join(testDir, '.please')
      mkdirSync(pleasePath, { recursive: true })
      writeFileSync(join(pleasePath, 'mcp.json'), '{"mcpServers": {"new": {}}}')

      const indexPath = join(testDir, 'config-changed.json')
      // Index was created with different config content
      const index = createValidIndex({
        configFingerprints: {
          local: { exists: false },
          project: { exists: true, hash: 'old-hash-different-from-current' },
          user: { exists: false },
        },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(indexPath, {}, testDir)

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.some(r => r.includes('Config project: content changed'))).toBe(true)
    })

    test('should accumulate multiple reasons', async () => {
      const indexPath = join(testDir, 'multiple-changes.json')
      const index = createValidIndex({
        cliVersion: '0.0.1',
        cliArgs: { mode: 'bm25', provider: 'local:minilm' },
      })
      writeFileSync(indexPath, JSON.stringify(index))

      const result = await checkIndexRegeneration(
        indexPath,
        { mode: 'embedding', provider: 'local:mdbr-leaf' },
      )

      expect(result.needsRebuild).toBe(true)
      expect(result.reasons.length).toBeGreaterThanOrEqual(3) // version + mode + provider
    })
  })
})

/**
 * Helper to create a valid index structure for testing
 */
function createValidIndex(overrides: {
  cliVersion?: string
  cliArgs?: { mode?: string, provider?: string, dtype?: string, exclude?: string[] }
  configFingerprints?: {
    local?: { exists: boolean, hash?: string }
    project?: { exists: boolean, hash?: string }
    user?: { exists: boolean, hash?: string }
  }
} = {}) {
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTools: 0,
    hasEmbeddings: false,
    bm25Stats: {
      avgDocLength: 0,
      documentFrequencies: {},
      totalDocuments: 0,
    },
    tools: [],
    buildMetadata: {
      cliVersion: overrides.cliVersion ?? getCliVersion(),
      cliArgs: overrides.cliArgs ?? {},
      configFingerprints: overrides.configFingerprints ?? {
        local: { exists: false },
        project: { exists: false },
        user: { exists: false },
      },
    },
  }
}
