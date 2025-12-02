import type { ToolDefinition } from '../types/index.js'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Supported file extensions
 */
const SUPPORTED_EXTENSIONS = ['.json', '.yaml', '.yml']

/**
 * Load tool definitions from JSON or YAML files
 */
export class ToolLoader {
  /**
   * Load tools from a file or directory
   */
  async load(path: string): Promise<ToolDefinition[]> {
    const stats = await stat(path)

    if (stats.isDirectory()) {
      return this.loadFromDirectory(path)
    }

    return this.loadFromFile(path)
  }

  /**
   * Load tools from multiple sources
   */
  async loadFromSources(sources: string[]): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = []

    for (const source of sources) {
      const tools = await this.load(source)
      allTools.push(...tools)
    }

    return this.deduplicateTools(allTools)
  }

  /**
   * Load tools from a single file
   */
  private async loadFromFile(filePath: string): Promise<ToolDefinition[]> {
    const ext = extname(filePath).toLowerCase()

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file extension: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`)
    }

    const content = await readFile(filePath, 'utf-8')

    let data: unknown
    if (ext === '.json') {
      data = JSON.parse(content)
    }
    else {
      data = parseYaml(content)
    }

    return this.parseToolDefinitions(data, filePath)
  }

  /**
   * Load tools from a directory (recursive)
   */
  private async loadFromDirectory(dirPath: string): Promise<ToolDefinition[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const tools: ToolDefinition[] = []

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const subTools = await this.loadFromDirectory(fullPath)
        tools.push(...subTools)
      }
      else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const fileTools = await this.loadFromFile(fullPath)
          tools.push(...fileTools)
        }
      }
    }

    return tools
  }

  /**
   * Parse raw data into tool definitions
   */
  private parseToolDefinitions(data: unknown, source: string): ToolDefinition[] {
    if (Array.isArray(data)) {
      return data.map((item, index) => this.validateTool(item, `${source}[${index}]`))
    }

    if (typeof data === 'object' && data !== null) {
      // Check if it's a single tool or an object with tools array
      const obj = data as Record<string, unknown>

      if ('tools' in obj && Array.isArray(obj.tools)) {
        return obj.tools.map((item, index) => this.validateTool(item, `${source}.tools[${index}]`))
      }

      // Check if it has name and description (single tool)
      if ('name' in obj && 'description' in obj) {
        return [this.validateTool(obj, source)]
      }
    }

    throw new Error(`Invalid tool definition format in ${source}`)
  }

  /**
   * Validate a tool definition
   */
  private validateTool(data: unknown, location: string): ToolDefinition {
    if (typeof data !== 'object' || data === null) {
      throw new Error(`Invalid tool at ${location}: expected object`)
    }

    const obj = data as Record<string, unknown>

    if (typeof obj.name !== 'string' || !obj.name) {
      throw new Error(`Invalid tool at ${location}: missing or invalid 'name'`)
    }

    if (typeof obj.description !== 'string') {
      throw new TypeError(`Invalid tool at ${location}: missing or invalid 'description'`)
    }

    const tool: ToolDefinition = {
      name: obj.name,
      description: obj.description,
      inputSchema: this.parseInputSchema(obj.inputSchema, location),
    }

    if (obj.title && typeof obj.title === 'string') {
      tool.title = obj.title
    }

    if (obj.outputSchema && typeof obj.outputSchema === 'object') {
      tool.outputSchema = obj.outputSchema as ToolDefinition['outputSchema']
    }

    if (obj.metadata && typeof obj.metadata === 'object') {
      tool.metadata = obj.metadata as Record<string, unknown>
    }

    return tool
  }

  /**
   * Parse input schema, providing defaults if missing
   */
  private parseInputSchema(schema: unknown, location: string): ToolDefinition['inputSchema'] {
    if (!schema) {
      return { type: 'object', properties: {} }
    }

    if (typeof schema !== 'object') {
      throw new TypeError(`Invalid inputSchema at ${location}: expected object`)
    }

    const obj = schema as Record<string, unknown>

    return {
      type: (obj.type as string) || 'object',
      properties: (obj.properties as Record<string, ToolDefinition['inputSchema']>) || {},
      required: obj.required as string[] | undefined,
      description: obj.description as string | undefined,
    }
  }

  /**
   * Remove duplicate tools by name
   */
  private deduplicateTools(tools: ToolDefinition[]): ToolDefinition[] {
    const seen = new Map<string, ToolDefinition>()

    for (const tool of tools) {
      if (!seen.has(tool.name)) {
        seen.set(tool.name, tool)
      }
    }

    return Array.from(seen.values())
  }
}
