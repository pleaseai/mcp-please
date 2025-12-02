import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { McpToolSearchServer } from '../src/server.js'

const TEST_OUTPUT_DIR = join(import.meta.dir, '../.test-output')
const TEST_INDEX_PATH = join(TEST_OUTPUT_DIR, 'server-test-index.json')

/**
 * Create a mock index for testing
 */
function createMockIndex(tools: Array<{ name: string, description: string, server?: string }>) {
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTools: tools.length,
    hasEmbeddings: false,
    bm25Stats: {
      avgDocLength: 2,
      documentFrequencies: {},
      totalDocuments: tools.length,
    },
    tools: tools.map(t => ({
      tool: {
        name: t.name,
        description: t.description,
        _meta: t.server ? { server: t.server } : undefined,
      },
      searchableText: `${t.name} ${t.description}`,
      tokens: t.name.split('_'),
    })),
  }
}

describe('McpToolSearchServer', () => {
  beforeAll(() => {
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true })
    }

    // Create basic test index
    const mockIndex = createMockIndex([
      { name: 'read_file', description: 'Read a file', server: 'filesystem' },
      { name: 'write_file', description: 'Write a file', server: 'filesystem' },
      { name: 'git_commit', description: 'Git commit', server: 'git' },
    ])
    writeFileSync(TEST_INDEX_PATH, JSON.stringify(mockIndex))
  })

  afterAll(() => {
    if (existsSync(TEST_INDEX_PATH)) {
      unlinkSync(TEST_INDEX_PATH)
    }
  })

  describe('generateIndexedToolsSummary', () => {
    test('should generate summary with tools grouped by server', async () => {
      const server = new McpToolSearchServer({
        indexPath: TEST_INDEX_PATH,
        defaultMode: 'bm25',
      })

      // Access private method via type assertion for testing
      const serverAny = server as unknown as {
        indexManager: { loadIndex: (path: string) => Promise<{ tools: Array<{ tool: { name: string, _meta?: { server?: string } } }> }> }
        cachedIndex: { tools: Array<{ tool: { name: string, _meta?: { server?: string } } }> }
        generateIndexedToolsSummary: () => string
      }

      // Load index first
      serverAny.cachedIndex = await serverAny.indexManager.loadIndex(TEST_INDEX_PATH)

      const summary = serverAny.generateIndexedToolsSummary()

      // Should contain "Indexed MCP tools" header
      expect(summary).toContain('Indexed MCP tools')
      expect(summary).toContain('search_tools')
      expect(summary).toContain('call_tool')

      // Should contain servers from mock index
      expect(summary).toContain('filesystem:')
      expect(summary).toContain('git:')
    })

    test('should return empty string when no index is loaded', () => {
      const server = new McpToolSearchServer({
        indexPath: TEST_INDEX_PATH,
        defaultMode: 'bm25',
      })

      const serverAny = server as unknown as {
        generateIndexedToolsSummary: () => string
      }

      const summary = serverAny.generateIndexedToolsSummary()

      expect(summary).toBe('')
    })

    test('should limit tools per server to 5 with count of remaining', async () => {
      // Create a mock index with many tools from one server
      const mockIndexPath = join(TEST_OUTPUT_DIR, 'mock-many-tools-index.json')
      const mockTools = Array.from({ length: 10 }, (_, i) => ({
        tool: {
          name: `tool_${i}`,
          description: `Test tool ${i}`,
          _meta: { server: 'test-server' },
        },
        searchableText: `tool ${i}`,
        tokens: ['tool', String(i)],
      }))

      const mockIndex = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTools: mockTools.length,
        hasEmbeddings: false,
        bm25Stats: {
          avgDocLength: 2,
          documentFrequencies: {},
          totalDocuments: mockTools.length,
        },
        tools: mockTools,
      }

      writeFileSync(mockIndexPath, JSON.stringify(mockIndex))

      try {
        const server = new McpToolSearchServer({
          indexPath: mockIndexPath,
          defaultMode: 'bm25',
        })

        const serverAny = server as unknown as {
          indexManager: { loadIndex: (path: string) => Promise<typeof mockIndex> }
          cachedIndex: typeof mockIndex
          generateIndexedToolsSummary: () => string
        }

        serverAny.cachedIndex = await serverAny.indexManager.loadIndex(mockIndexPath)

        const summary = serverAny.generateIndexedToolsSummary()

        // Should show first 5 tools and indicate more
        expect(summary).toContain('test-server:')
        expect(summary).toContain('tool_0')
        expect(summary).toContain('tool_4')
        expect(summary).toContain('(+5 more)')
        expect(summary).not.toContain('tool_5,') // Should not list tool_5 in the display
      }
      finally {
        if (existsSync(mockIndexPath)) {
          unlinkSync(mockIndexPath)
        }
      }
    })

    test('should group tools by server name', async () => {
      // Create a mock index with tools from multiple servers
      const mockIndexPath = join(TEST_OUTPUT_DIR, 'mock-multi-server-index.json')
      const mockTools = [
        { tool: { name: 'tool_a1', description: 'A1', _meta: { server: 'server-a' } }, searchableText: 'a1', tokens: ['a1'] },
        { tool: { name: 'tool_a2', description: 'A2', _meta: { server: 'server-a' } }, searchableText: 'a2', tokens: ['a2'] },
        { tool: { name: 'tool_b1', description: 'B1', _meta: { server: 'server-b' } }, searchableText: 'b1', tokens: ['b1'] },
        { tool: { name: 'tool_c1', description: 'C1', _meta: { server: 'server-c' } }, searchableText: 'c1', tokens: ['c1'] },
      ]

      const mockIndex = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTools: mockTools.length,
        hasEmbeddings: false,
        bm25Stats: {
          avgDocLength: 1,
          documentFrequencies: {},
          totalDocuments: mockTools.length,
        },
        tools: mockTools,
      }

      writeFileSync(mockIndexPath, JSON.stringify(mockIndex))

      try {
        const server = new McpToolSearchServer({
          indexPath: mockIndexPath,
          defaultMode: 'bm25',
        })

        const serverAny = server as unknown as {
          indexManager: { loadIndex: (path: string) => Promise<typeof mockIndex> }
          cachedIndex: typeof mockIndex
          generateIndexedToolsSummary: () => string
        }

        serverAny.cachedIndex = await serverAny.indexManager.loadIndex(mockIndexPath)

        const summary = serverAny.generateIndexedToolsSummary()

        // Should contain all servers
        expect(summary).toContain('server-a:')
        expect(summary).toContain('server-b:')
        expect(summary).toContain('server-c:')

        // Should group tools correctly
        expect(summary).toContain('tool_a1')
        expect(summary).toContain('tool_a2')
        expect(summary).toContain('tool_b1')
        expect(summary).toContain('tool_c1')
      }
      finally {
        if (existsSync(mockIndexPath)) {
          unlinkSync(mockIndexPath)
        }
      }
    })

    test('should handle tools without server metadata as unknown', async () => {
      const mockIndexPath = join(TEST_OUTPUT_DIR, 'mock-no-server-index.json')
      const mockTools = [
        { tool: { name: 'orphan_tool', description: 'No server' }, searchableText: 'orphan', tokens: ['orphan'] },
      ]

      const mockIndex = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTools: mockTools.length,
        hasEmbeddings: false,
        bm25Stats: {
          avgDocLength: 1,
          documentFrequencies: {},
          totalDocuments: mockTools.length,
        },
        tools: mockTools,
      }

      writeFileSync(mockIndexPath, JSON.stringify(mockIndex))

      try {
        const server = new McpToolSearchServer({
          indexPath: mockIndexPath,
          defaultMode: 'bm25',
        })

        const serverAny = server as unknown as {
          indexManager: { loadIndex: (path: string) => Promise<typeof mockIndex> }
          cachedIndex: typeof mockIndex
          generateIndexedToolsSummary: () => string
        }

        serverAny.cachedIndex = await serverAny.indexManager.loadIndex(mockIndexPath)

        const summary = serverAny.generateIndexedToolsSummary()

        expect(summary).toContain('unknown:')
        expect(summary).toContain('orphan_tool')
      }
      finally {
        if (existsSync(mockIndexPath)) {
          unlinkSync(mockIndexPath)
        }
      }
    })
  })
})
