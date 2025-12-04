import type { ToolDefinition } from '@pleaseai/mcp-core'
import { describe, expect, test } from 'bun:test'
import { generateCliUsage, generateDetailedCliUsage } from '../src/utils/cli-usage.js'

describe('cli-usage', () => {
  describe('generateCliUsage', () => {
    test('should generate usage for tool with required string fields', () => {
      const tool: ToolDefinition = {
        name: 'server__read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toBe('mcp-gateway call "server__read_file" --args \'{"path":"<string>"}\'')
    })

    test('should generate usage for tool with multiple required fields', () => {
      const tool: ToolDefinition = {
        name: 'server__write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toContain('server__write_file')
      expect(usage).toContain('"path":"<string>"')
      expect(usage).toContain('"content":"<string>"')
    })

    test('should generate usage with enum placeholders', () => {
      const tool: ToolDefinition = {
        name: 'server__set_mode',
        description: 'Set operation mode',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['read', 'write', 'append'],
            },
          },
          required: ['mode'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toContain('<read|write|append>')
    })

    test('should generate usage with number type placeholder', () => {
      const tool: ToolDefinition = {
        name: 'server__get_page',
        description: 'Get page',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
          },
          required: ['page'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toContain('"page":"<number>"')
    })

    test('should generate usage with boolean type placeholder', () => {
      const tool: ToolDefinition = {
        name: 'server__toggle',
        description: 'Toggle feature',
        inputSchema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
          },
          required: ['enabled'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toContain('"enabled":"<true|false>"')
    })

    test('should generate empty args for tool with no required fields', () => {
      const tool: ToolDefinition = {
        name: 'server__list',
        description: 'List items',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toBe('mcp-gateway call "server__list" --args \'{}\'')
    })

    test('should truncate long enum lists', () => {
      const tool: ToolDefinition = {
        name: 'server__set_status',
        description: 'Set status',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'active', 'completed', 'cancelled', 'archived'],
            },
          },
          required: ['status'],
        },
      }

      const usage = generateCliUsage(tool)

      expect(usage).toContain('<pending|active|completed|...>')
    })
  })

  describe('generateDetailedCliUsage', () => {
    test('should generate both args and stdin examples', () => {
      const tool: ToolDefinition = {
        name: 'server__read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      }

      const { argsExample, stdinExample } = generateDetailedCliUsage(tool)

      expect(argsExample).toContain('--args')
      expect(stdinExample).toContain('echo')
      expect(stdinExample).toContain('|')
      expect(stdinExample).toContain('mcp-gateway call')
    })
  })
})
