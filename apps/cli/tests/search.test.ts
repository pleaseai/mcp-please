import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, '../dist/index.js');
const EXAMPLES_PATH = join(import.meta.dir, '../examples/tools.json');
const TEST_OUTPUT_DIR = join(import.meta.dir, '../.test-output');
const TEST_INDEX_PATH = join(TEST_OUTPUT_DIR, 'search-test-index.json');

/**
 * Extract JSON from CLI output (handles spinner/status lines mixed with JSON)
 */
function extractJson(output: string): unknown {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in output: ${output}`);
  }
  return JSON.parse(jsonMatch[0]);
}

describe('search command', () => {
  beforeAll(async () => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }

    // Create test index without embeddings for fast tests
    await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${TEST_INDEX_PATH} --no-embeddings -f`.quiet();
  });

  afterAll(() => {
    if (existsSync(TEST_INDEX_PATH)) {
      unlinkSync(TEST_INDEX_PATH);
    }
  });

  test('should show help', async () => {
    const result = await $`bun ${CLI_PATH} search --help`.text();

    expect(result).toContain('Search for tools in the index');
    expect(result).toContain('--mode');
    expect(result).toContain('regex | bm25 | embedding');
    expect(result).toContain('--provider');
    expect(result).toContain('local:minilm');
  });

  test('should search with BM25 mode (default)', async () => {
    const result = await $`bun ${CLI_PATH} search "file" -i ${TEST_INDEX_PATH} -f json`.text();

    const parsed = extractJson(result) as { query: string; mode: string; tools: Array<{ name: string }> };

    expect(parsed.query).toBe('file');
    expect(parsed.mode).toBe('bm25');
    expect(parsed.tools.length).toBeGreaterThan(0);

    // Should find file-related tools
    const names = parsed.tools.map((r) => r.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  test('should search with regex mode', async () => {
    const result = await $`bun ${CLI_PATH} search "read.*" -i ${TEST_INDEX_PATH} -m regex -f json`.text();

    const parsed = extractJson(result) as { mode: string; tools: Array<{ name: string }> };

    expect(parsed.mode).toBe('regex');
    expect(parsed.tools.length).toBeGreaterThan(0);
    expect(parsed.tools[0].name).toBe('read_file');
  });

  test('should respect top-k parameter', async () => {
    const result = await $`bun ${CLI_PATH} search "file" -i ${TEST_INDEX_PATH} -k 3 -f json`.text();

    const parsed = extractJson(result) as { tools: Array<{ name: string }> };

    expect(parsed.tools.length).toBeLessThanOrEqual(3);
  });

  test('should output in table format', async () => {
    const result = await $`bun ${CLI_PATH} search "email" -i ${TEST_INDEX_PATH} -f table`.text();

    expect(result).toContain('send_email');
    expect(result).toContain('Score');
    expect(result).toContain('Name');
  });

  test('should output in minimal format', async () => {
    const result = await $`bun ${CLI_PATH} search "git" -i ${TEST_INDEX_PATH} -f minimal`.text();

    expect(result).toContain('git_commit');
  });

  test('should fail for embedding search without embeddings in index', async () => {
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'search', 'file', '-i', TEST_INDEX_PATH, '-m', 'embedding'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const output = stdout + stderr;

    expect(exitCode).toBe(1);
    expect(output).toContain('does not contain embeddings');
  });
});
