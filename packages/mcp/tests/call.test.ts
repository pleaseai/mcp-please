import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const CLI_PATH = join(import.meta.dir, '../dist/cli.js')
const EXAMPLES_PATH = join(import.meta.dir, '../examples/tools.json')
const TEST_OUTPUT_DIR = join(import.meta.dir, '../.test-output')
const TEST_INDEX_PATH = join(TEST_OUTPUT_DIR, 'call-test-index.json')

describe('call command', () => {
  beforeAll(async () => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true })
    }

    // Create test index without embeddings for fast tests
    await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${TEST_INDEX_PATH} --no-embeddings -f`.quiet()
  })

  afterAll(() => {
    if (existsSync(TEST_INDEX_PATH)) {
      unlinkSync(TEST_INDEX_PATH)
    }
  })

  test('should show help', async () => {
    const result = await $`bun ${CLI_PATH} call --help`.text()

    expect(result).toContain('Call a tool on an MCP server')
    expect(result).toContain('--args')
    expect(result).toContain('--format')
    expect(result).toContain('json | minimal')
  })

  test('should fail with exit code 1 for tool not found', async () => {
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'nonexistent_tool', '-i', TEST_INDEX_PATH],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    expect(stderr).toContain('not found')
  })

  test('should fail with exit code 1 for server not configured', async () => {
    // Use a tool from the examples index that doesn't have server metadata
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'read_file', '-i', TEST_INDEX_PATH],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    // Should fail because examples/tools.json tools don't have server metadata
    expect(stderr).toContain('metadata missing')
  })

  test('should fail with exit code 1 for invalid JSON args', async () => {
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'read_file', '-i', TEST_INDEX_PATH, '--args', 'invalid json'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Invalid JSON')
  })

  test('should accept valid JSON args', async () => {
    // This will still fail (no server config) but should parse args successfully
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'read_file', '-i', TEST_INDEX_PATH, '--args', '{"path":"/tmp/test"}'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    // Should fail at metadata step, not JSON parsing
    expect(stderr).not.toContain('Invalid JSON')
  })

  test('should support minimal output format flag', async () => {
    // Test that --format minimal is accepted (will still error due to no server)
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'read_file', '-i', TEST_INDEX_PATH, '-f', 'minimal'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    // Error output should be in minimal format (not JSON)
    expect(stderr).not.toContain('{')
  })

  test('should support json output format flag', async () => {
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'call', 'read_file', '-i', TEST_INDEX_PATH, '-f', 'json'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(1)
    // Error output should be in JSON format
    expect(stderr).toContain('{')
    expect(stderr).toContain('"error"')
  })
})
