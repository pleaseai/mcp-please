/**
 * JSON Schema representation for tool parameters
 */
export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  description?: string
  items?: JsonSchema
  enum?: string[]
  default?: unknown
  additionalProperties?: boolean | JsonSchema
}

/**
 * Tool definition following MCP specification
 */
export interface ToolDefinition {
  name: string
  title?: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  metadata?: Record<string, unknown>
}

/**
 * Indexed tool with precomputed searchable text and optional embedding
 */
export interface IndexedTool {
  tool: ToolDefinition
  searchableText: string
  tokens: string[]
  embedding?: number[]
}

/**
 * Tool reference returned by search
 */
export interface ToolReference {
  name: string
  title?: string
  description: string
  score: number
  matchType: SearchMode
}

/**
 * Available search modes
 */
export type SearchMode = 'regex' | 'bm25' | 'embedding'
