import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: 'stdio' | 'http' | 'sse'
}

/**
 * MCP configuration file structure
 */
export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>
}

/**
 * Config source with priority
 */
export interface ConfigSource {
  type: 'user' | 'project' | 'local'
  path: string
  config: McpConfig
}

/**
 * Merged MCP server entry with source info
 */
export interface MergedServerEntry {
  name: string
  config: McpServerConfig
  source: 'user' | 'project' | 'local'
}

/**
 * Get user-level MCP config path
 * User-wide settings in ~/.please/mcp.json
 */
function getUserConfigPath(): string {
  const home = homedir()
  return join(home, '.please', 'mcp.json')
}

/**
 * Get project-level MCP config path
 * Project-wide settings in .please/mcp.json
 */
function getProjectConfigPath(): string {
  return join(process.cwd(), '.please', 'mcp.json')
}

/**
 * Get local MCP config path (for user-specific overrides)
 * Local overrides in .please/mcp.local.json (gitignored)
 */
function getLocalConfigPath(): string {
  return join(process.cwd(), '.please', 'mcp.local.json')
}

/**
 * Read and parse MCP config file
 */
function readConfigFile(path: string): McpConfig | null {
  if (!existsSync(path)) {
    return null
  }

  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as McpConfig
  }
  catch {
    return null
  }
}

/**
 * Load MCP configs from all sources
 * Priority: local > project > user (later overrides earlier)
 */
export function loadMcpConfigs(): ConfigSource[] {
  const sources: ConfigSource[] = []

  // User config (lowest priority)
  const userPath = getUserConfigPath()
  const userConfig = readConfigFile(userPath)
  if (userConfig) {
    sources.push({ type: 'user', path: userPath, config: userConfig })
  }

  // Project config
  const projectPath = getProjectConfigPath()
  const projectConfig = readConfigFile(projectPath)
  if (projectConfig) {
    sources.push({ type: 'project', path: projectPath, config: projectConfig })
  }

  // Local config (highest priority)
  const localPath = getLocalConfigPath()
  const localConfig = readConfigFile(localPath)
  if (localConfig) {
    sources.push({ type: 'local', path: localPath, config: localConfig })
  }

  return sources
}

/**
 * Merge MCP servers from all config sources
 * Later sources override earlier ones
 */
export function mergeMcpServers(sources: ConfigSource[]): MergedServerEntry[] {
  const serverMap = new Map<string, MergedServerEntry>()

  for (const source of sources) {
    if (!source.config.mcpServers) {
      continue
    }

    for (const [name, config] of Object.entries(source.config.mcpServers)) {
      serverMap.set(name, {
        name,
        config,
        source: source.type,
      })
    }
  }

  return Array.from(serverMap.values())
}

/**
 * Load and merge all MCP servers
 */
export function loadAllMcpServers(): MergedServerEntry[] {
  const sources = loadMcpConfigs()
  return mergeMcpServers(sources)
}
