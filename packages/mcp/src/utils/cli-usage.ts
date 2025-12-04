/**
 * CLI Usage Template Generator
 * Generates cliUsage template strings for tools
 */

import type { ToolDefinition } from '@pleaseai/mcp-core'

/**
 * Valid JSON Schema types
 */
type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'

interface JsonSchemaProperty {
  type?: JsonSchemaType
  description?: string
  enum?: unknown[]
  default?: unknown
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

/**
 * Generate a CLI usage template string for a tool
 *
 * @param tool - The tool definition
 * @returns A template string showing how to call the tool via CLI
 *
 * @example
 * // For a tool with required fields: path (string), content (string)
 * // Returns: 'mcp-search call "server__tool" --args \'{"path": "<string>", "content": "<string>"}\''
 */
export function generateCliUsage(tool: ToolDefinition): string {
  const schema = tool.inputSchema as JsonSchema
  const properties = schema.properties || {}
  const requiredFields = schema.required || []

  // Build example args object with placeholders for required fields
  const exampleArgs: Record<string, string> = {}

  for (const field of requiredFields) {
    const prop = properties[field]
    exampleArgs[field] = getPlaceholder(prop)
  }

  // Format the args JSON
  const argsJson = Object.keys(exampleArgs).length > 0
    ? JSON.stringify(exampleArgs)
    : '{}'

  return `mcp-search call "${tool.name}" --args '${argsJson}'`
}

/**
 * Generate a placeholder value for a schema property
 */
function getPlaceholder(prop?: JsonSchemaProperty): string {
  if (!prop)
    return '<value>'

  // Use enum values if available
  if (prop.enum && prop.enum.length > 0) {
    return `<${prop.enum.slice(0, 3).join('|')}${prop.enum.length > 3 ? '|...' : ''}>`
  }

  // Use type-based placeholders
  switch (prop.type) {
    case 'string':
      return '<string>'
    case 'number':
    case 'integer':
      return '<number>'
    case 'boolean':
      return '<true|false>'
    case 'array':
      return '<array>'
    case 'object':
      return '<object>'
    default:
      return '<value>'
  }
}

/**
 * Generate a detailed CLI usage example with stdin alternative
 *
 * @param tool - The tool definition
 * @returns An object with both --args and stdin usage examples
 */
export function generateDetailedCliUsage(tool: ToolDefinition): {
  argsExample: string
  stdinExample: string
} {
  const argsExample = generateCliUsage(tool)

  const schema = tool.inputSchema as JsonSchema
  const properties = schema.properties || {}
  const requiredFields = schema.required || []

  // Build example args for stdin
  const exampleArgs: Record<string, string> = {}
  for (const field of requiredFields) {
    const prop = properties[field]
    exampleArgs[field] = getPlaceholder(prop)
  }

  const argsJson = Object.keys(exampleArgs).length > 0
    ? JSON.stringify(exampleArgs, null, 2)
    : '{}'

  const stdinExample = `echo '${argsJson}' | mcp-search call "${tool.name}"`

  return { argsExample, stdinExample }
}
