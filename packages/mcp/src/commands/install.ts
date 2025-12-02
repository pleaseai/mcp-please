import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { Command } from 'commander'
import ora from 'ora'
import { DEFAULT_INDEX_PATH, MCP_SERVER_NAME, PACKAGE_NAME } from '../constants.js'
import { error, info, success, warn } from '../utils/output.js'

type IdeType = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode' | 'gemini' | 'codex'

interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

interface CodexMcpConfig {
  mcp_servers: Record<string, {
    command: string
    args: string[]
    env?: Record<string, string>
  }>
}

/**
 * Get config file path for each IDE
 */
function getConfigPath(ide: IdeType): string {
  const home = homedir()

  switch (ide) {
    case 'claude-desktop': {
      // Claude Desktop config path varies by OS
      if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      }
      else if (process.platform === 'win32') {
        return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      }
      else {
        return join(home, '.config', 'Claude', 'claude_desktop_config.json')
      }
    }
    case 'claude-code':
      // Claude Code uses .mcp.json in project root or ~/.claude/settings.json
      return join(process.cwd(), '.mcp.json')
    case 'vscode':
      return join(process.cwd(), '.vscode', 'mcp.json')
    case 'cursor':
      return join(process.cwd(), '.cursor', 'mcp.json')
    case 'gemini':
      // Gemini CLI uses ~/.gemini/settings.json
      return join(home, '.gemini', 'settings.json')
    case 'codex':
      // OpenAI Codex uses ~/.codex/config.toml
      return join(home, '.codex', 'config.toml')
    default:
      throw new Error(`Unknown IDE: ${ide}`)
  }
}

/**
 * Get IDE display name
 */
function getIdeName(ide: IdeType): string {
  switch (ide) {
    case 'claude-desktop':
      return 'Claude Desktop'
    case 'claude-code':
      return 'Claude Code'
    case 'vscode':
      return 'VS Code'
    case 'cursor':
      return 'Cursor'
    case 'gemini':
      return 'Gemini CLI'
    case 'codex':
      return 'OpenAI Codex'
    default:
      return ide
  }
}

/**
 * Check if IDE uses TOML format (Codex)
 */
function usesToml(ide: IdeType): boolean {
  return ide === 'codex'
}

/**
 * Generate MCP server configuration
 */
function generateServerConfig(indexPath: string): McpServerConfig {
  return {
    command: 'npx',
    args: [PACKAGE_NAME, 'serve', '-i', indexPath],
  }
}

/**
 * Read existing JSON config or create empty one
 */
function readJsonConfig(configPath: string): McpConfig {
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8')
      return JSON.parse(content) as McpConfig
    }
    catch {
      return { mcpServers: {} }
    }
  }
  return { mcpServers: {} }
}

/**
 * Read existing TOML config or create empty one (for Codex)
 */
function readTomlConfig(configPath: string): CodexMcpConfig {
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8')
      // Simple TOML parsing for mcp_servers section
      const mcpServers: CodexMcpConfig['mcp_servers'] = {}

      // Find [mcp_servers.xxx] sections
      const serverRegex = /\[mcp_servers\.([^\]]+)\]/g
      let match
      while ((match = serverRegex.exec(content)) !== null) {
        const serverName = match[1]
        const startIndex = match.index + match[0].length
        const nextSectionIndex = content.indexOf('\n[', startIndex)
        const sectionContent = nextSectionIndex === -1
          ? content.slice(startIndex)
          : content.slice(startIndex, nextSectionIndex)

        // Parse command and args
        const commandMatch = sectionContent.match(/command\s*=\s*"([^"]+)"/)
        const argsMatch = sectionContent.match(/args\s*=\s*\[([^\]]*)\]/)

        if (commandMatch) {
          mcpServers[serverName] = {
            command: commandMatch[1],
            args: argsMatch
              ? argsMatch[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean)
              : [],
          }
        }
      }

      return { mcp_servers: mcpServers }
    }
    catch {
      return { mcp_servers: {} }
    }
  }
  return { mcp_servers: {} }
}

/**
 * Write JSON config to file
 */
function writeJsonConfig(configPath: string, config: McpConfig): void {
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

/**
 * Generate TOML entry for Codex
 */
function generateTomlEntry(serverName: string, indexPath: string): string {
  return `
[mcp_servers.${serverName}]
command = "npx"
args = ["${PACKAGE_NAME}", "serve", "-i", "${indexPath}"]
`
}

/**
 * Write or append TOML config for Codex
 */
function writeTomlConfig(configPath: string, serverName: string, indexPath: string): void {
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  let content = ''
  if (existsSync(configPath)) {
    content = readFileSync(configPath, 'utf-8')

    // Remove existing server config if present
    const serverPattern = new RegExp(`\\[mcp_servers\\.${serverName}\\][^\\[]*`, 'g')
    content = content.replace(serverPattern, '')
  }

  // Append new server config
  content = content.trimEnd() + '\n' + generateTomlEntry(serverName, indexPath)
  writeFileSync(configPath, content.trim() + '\n')
}

/**
 * Get restart hint message for each IDE
 */
function getRestartHint(ide: IdeType): string {
  switch (ide) {
    case 'claude-desktop':
      return 'Please restart Claude Desktop to apply changes.'
    case 'claude-code':
      return 'MCP server will be available in this project.'
    case 'vscode':
    case 'cursor':
      return `Please reload the ${getIdeName(ide)} window to apply changes.`
    case 'gemini':
      return 'MCP server will be available in Gemini CLI. Run /mcp to verify.'
    case 'codex':
      return 'MCP server will be available in Codex. Run `codex mcp list` to verify.'
    default:
      return 'Please restart the application to apply changes.'
  }
}

/**
 * Create the install command
 */
export function createInstallCommand(): Command {
  const ideChoices = 'claude-desktop | claude-code | cursor | vscode | gemini | codex'

  const cmd = new Command('install')
    .description('Install MCP server to IDE configuration')
    .option('--ide <type>', `IDE type: ${ideChoices}`, 'claude-code')
    .option('-i, --index <path>', 'Path to index file', DEFAULT_INDEX_PATH)
    .option('--dry-run', 'Preview changes without writing')
    .option('--name <name>', 'Server name in config', MCP_SERVER_NAME)
    .action(async (options) => {
      const spinner = ora('Installing MCP server...').start()

      try {
        const ide = options.ide as IdeType
        const indexPath = resolve(options.index)
        const serverName = options.name as string
        const dryRun = options.dryRun as boolean

        // Get config path
        const configPath = getConfigPath(ide)
        const ideName = getIdeName(ide)

        spinner.text = `Configuring ${ideName}...`

        if (usesToml(ide)) {
          // Handle TOML config (Codex)
          const config = readTomlConfig(configPath)

          if (config.mcp_servers[serverName]) {
            warn(`Server "${serverName}" already exists in config. It will be overwritten.`)
          }

          if (dryRun) {
            spinner.stop()
            info('Dry run - no changes written')
            info(`Config path: ${configPath}`)
            info('Generated config:')
            console.log(generateTomlEntry(serverName, indexPath))
            return
          }

          writeTomlConfig(configPath, serverName, indexPath)
        }
        else {
          // Handle JSON config
          const config = readJsonConfig(configPath)

          if (config.mcpServers && config.mcpServers[serverName]) {
            warn(`Server "${serverName}" already exists in config. It will be overwritten.`)
          }

          // Ensure mcpServers exists
          if (!config.mcpServers) {
            config.mcpServers = {}
          }

          // Generate new server config
          const serverConfig = generateServerConfig(indexPath)
          config.mcpServers[serverName] = serverConfig

          if (dryRun) {
            spinner.stop()
            info('Dry run - no changes written')
            info(`Config path: ${configPath}`)
            info('Generated config:')
            console.log(JSON.stringify(config, null, 2))
            return
          }

          writeJsonConfig(configPath, config)
        }

        spinner.succeed(`MCP server installed to ${ideName}`)
        success(`Config written to: ${configPath}`)
        info(`Server name: ${serverName}`)
        info(`Index path: ${indexPath}`)
        warn(getRestartHint(ide))
      }
      catch (err) {
        spinner.fail('Installation failed')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })

  return cmd
}
