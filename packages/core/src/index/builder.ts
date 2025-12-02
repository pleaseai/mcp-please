import type { IndexedTool, JsonSchema, ToolDefinition } from '../types/index.js'

/**
 * Common English stop words to filter out during tokenization
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
  'this',
  'which',
  'you',
  'your',
  'can',
  'could',
  'would',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'into',
  'if',
  'then',
  'than',
  'so',
  'no',
  'not',
  'only',
  'own',
  'same',
  'such',
  'too',
  'very',
  'just',
  'but',
  'also',
])

/**
 * Build searchable index from tool definitions
 */
export class IndexBuilder {
  /**
   * Build indexed tools from tool definitions
   */
  buildIndex(tools: ToolDefinition[]): IndexedTool[] {
    return tools.map(tool => this.buildIndexedTool(tool))
  }

  /**
   * Build a single indexed tool
   */
  private buildIndexedTool(tool: ToolDefinition): IndexedTool {
    const searchableText = this.buildSearchableText(tool)
    const tokens = this.tokenize(searchableText)

    return {
      tool,
      searchableText,
      tokens,
    }
  }

  /**
   * Build searchable text by combining tool attributes
   */
  buildSearchableText(tool: ToolDefinition): string {
    const parts: string[] = []

    // Add name (split camelCase/snake_case)
    parts.push(this.splitIdentifier(tool.name))

    // Add title if present
    if (tool.title) {
      parts.push(tool.title)
    }

    // Add description
    parts.push(tool.description)

    // Add parameter information
    if (tool.inputSchema.properties) {
      for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
        parts.push(this.splitIdentifier(paramName))
        parts.push(this.extractSchemaText(paramSchema))
      }
    }

    // Add metadata tags if present
    if (tool.metadata?.tags && Array.isArray(tool.metadata.tags)) {
      parts.push(...tool.metadata.tags.map(String))
    }

    return parts.filter(Boolean).join(' ')
  }

  /**
   * Split identifier names (camelCase, snake_case, kebab-case)
   */
  private splitIdentifier(name: string): string {
    return name
      // Split camelCase
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Split snake_case and kebab-case
      .replace(/[_-]/g, ' ')
      .toLowerCase()
  }

  /**
   * Extract text from JSON schema
   */
  private extractSchemaText(schema: JsonSchema): string {
    const parts: string[] = []

    if (schema.description) {
      parts.push(schema.description)
    }

    if (schema.type) {
      parts.push(schema.type)
    }

    if (schema.enum) {
      parts.push(...schema.enum)
    }

    // Recursively process nested properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        parts.push(this.splitIdentifier(propName))
        parts.push(this.extractSchemaText(propSchema))
      }
    }

    // Process array items
    if (schema.items) {
      parts.push(this.extractSchemaText(schema.items))
    }

    return parts.filter(Boolean).join(' ')
  }

  /**
   * Tokenize text for BM25 search
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      // Remove special characters except spaces
      .replace(/[^a-z0-9\s]/g, ' ')
      // Split by whitespace
      .split(/\s+/)
      // Filter out stop words and short tokens
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  }

  /**
   * Get unique tokens (for vocabulary building)
   */
  getVocabulary(indexedTools: IndexedTool[]): Set<string> {
    const vocabulary = new Set<string>()

    for (const indexed of indexedTools) {
      for (const token of indexed.tokens) {
        vocabulary.add(token)
      }
    }

    return vocabulary
  }
}
