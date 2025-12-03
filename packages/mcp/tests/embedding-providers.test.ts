import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

// Skip embedding tests in CI - they require model downloads
const skipInCI = process.env.CI === 'true'

// Set default timeout for model loading
setDefaultTimeout(60000)

const CLI_PATH = join(import.meta.dir, '../dist/cli.js')
const EXAMPLES_PATH = join(import.meta.dir, '../examples/tools.json')
const TEST_OUTPUT_DIR = join(import.meta.dir, '../.test-output')

/**
 * Extract JSON from CLI output (handles spinner/status lines mixed with JSON)
 */
function extractJson(output: string): unknown {
  const jsonMatch = output.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`No JSON found in output: ${output}`)
  }
  return JSON.parse(jsonMatch[0])
}

describe.skipIf(skipInCI)('embedding providers', () => {
  beforeAll(() => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true })
    }
  })

  afterAll(() => {
    const files = ['index-minilm.json', 'index-mdbr.json']
    for (const file of files) {
      const path = join(TEST_OUTPUT_DIR, file)
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
  })

  test('should index with local:minilm provider', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'index-minilm.json')

    const result = await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${outputPath} -p local:minilm -f`.text()

    expect(result).toContain('local:minilm embeddings')
    expect(result).toContain('384 dimensions')
    expect(result).toContain('Index saved to')
    expect(existsSync(outputPath)).toBe(true)

    const index = await Bun.file(outputPath).json()
    expect(index.hasEmbeddings).toBe(true)
    expect(index.tools[0].embedding).toHaveLength(384)
  }, 60000) // 60s timeout for model download

  test('should index with local:mdbr-leaf provider', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'index-mdbr.json')

    const result = await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${outputPath} -p local:mdbr-leaf -f`.text()

    expect(result).toContain('local:mdbr-leaf embeddings')
    expect(result).toContain('256 dimensions')
    expect(result).toContain('Index saved to')
    expect(existsSync(outputPath)).toBe(true)

    const index = await Bun.file(outputPath).json()
    expect(index.hasEmbeddings).toBe(true)
    expect(index.tools[0].embedding).toHaveLength(256)
  }, 60000) // 60s timeout for model download

  test('should search with local:mdbr-leaf embeddings', async () => {
    const indexPath = join(TEST_OUTPUT_DIR, 'index-mdbr.json')

    // Ensure index exists from previous test
    if (!existsSync(indexPath)) {
      await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${indexPath} -p local:mdbr-leaf -f`.quiet()
    }

    const result = await $`bun ${CLI_PATH} search "file operations" -i ${indexPath} -m embedding -p local:mdbr-leaf -f json`.text()

    const parsed = extractJson(result) as { mode: string, tools: Array<{ name: string }> }

    expect(parsed.mode).toBe('embedding')
    expect(parsed.tools.length).toBeGreaterThan(0)

    // File-related tools should rank high
    const topNames = parsed.tools.slice(0, 5).map(r => r.name)
    expect(topNames.some((name: string) => name.includes('file') || name.includes('directory'))).toBe(true)
  }, 60000)
})
