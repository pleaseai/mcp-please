/**
 * CLI Usage Template Generator
 * Generates cliUsage template strings for tools
 */

import type { ToolDefinition } from '@pleaseai/mcp-core'

/**
 * Package specifier for CLI usage commands
 */
const MCP_GATEWAY_PACKAGE = '@pleaseai/mcp-gateway@beta'

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

interface CliUsageJsonSchema {
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

/**
 * Build example args object from tool schema
 */
function buildExampleArgs(tool: ToolDefinition): Record<string, string> {
  const schema = tool.inputSchema as CliUsageJsonSchema
  const properties = schema.properties || {}
  const requiredFields = schema.required || []
  const exampleArgs: Record<string, string> = {}

  for (const field of requiredFields) {
    const prop = properties[field]
    exampleArgs[field] = getPlaceholder(prop)
  }
  return exampleArgs
}

/**
 * Generate a CLI usage template string for a tool
 *
 * @param tool - The tool definition
 * @returns A template string showing how to call the tool via CLI
 *
 * @example
 * // For a tool with required fields: path (string), content (string)
 * // Returns: 'npx @pleaseai/mcp-gateway server__tool --args \'{"path": "<string>", "content": "<string>"}\''
 */
export function generateCliUsage(tool: ToolDefinition): string {
  const exampleArgs = buildExampleArgs(tool)

  // Format the args JSON
  const argsJson = Object.keys(exampleArgs).length > 0
    ? JSON.stringify(exampleArgs)
    : '{}'

  // Direct tool execution format enables permission patterns like: Bash(mcp-gateway server__*:*)
  return `npx ${MCP_GATEWAY_PACKAGE} ${tool.name} --args '${argsJson}'`
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
  const exampleArgs = buildExampleArgs(tool)

  const argsJson = Object.keys(exampleArgs).length > 0
    ? JSON.stringify(exampleArgs, null, 2)
    : '{}'

  const stdinExample = `echo '${argsJson}' | npx ${MCP_GATEWAY_PACKAGE} ${tool.name}`

  return { argsExample, stdinExample }
}
