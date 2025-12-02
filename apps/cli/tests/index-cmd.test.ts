import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, '../dist/index.js');
const EXAMPLES_PATH = join(import.meta.dir, '../examples/tools.json');
const TEST_OUTPUT_DIR = join(import.meta.dir, '../.test-output');

describe('index command', () => {
  beforeAll(() => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup test outputs
    const files = ['index-minilm.json', 'index-mdbr.json', 'index-no-embed.json'];
    for (const file of files) {
      const path = join(TEST_OUTPUT_DIR, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  });

  test('should show help', async () => {
    const result = await $`bun ${CLI_PATH} index --help`.text();

    expect(result).toContain('Build search index from tool definitions');
    expect(result).toContain('--provider');
    expect(result).toContain('local:minilm');
    expect(result).toContain('local:mdbr-leaf');
    expect(result).toContain('api:openai');
    expect(result).toContain('api:voyage');
  });

  test('should index without embeddings', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'index-no-embed.json');

    const result = await $`bun ${CLI_PATH} index ${EXAMPLES_PATH} -o ${outputPath} --no-embeddings -f`.text();

    expect(result).toContain('Index saved to');
    expect(result).toContain('Embeddings: No');
    expect(existsSync(outputPath)).toBe(true);

    const index = await Bun.file(outputPath).json();
    expect(index.tools).toHaveLength(15);
    expect(index.hasEmbeddings).toBe(false);
  });

  test('should reject invalid provider type', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'index-invalid.json');

    const proc = Bun.spawn(['bun', CLI_PATH, 'index', EXAMPLES_PATH, '-o', outputPath, '-p', 'invalid-provider', '-f'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown embedding provider type');
  });
});
