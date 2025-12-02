import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import Table from 'cli-table3'
import { Command } from 'commander'
import ora from 'ora'
import { error, info, success, warn } from '../utils/output.js'

type TransportType = 'stdio' | 'http' | 'sse'
type ScopeType = 'local' | 'project' | 'user'

interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: TransportType
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

/**
 * Get config file path based on scope
 * - local: .please/mcp.local.json (default, local overrides, gitignored)
 * - project: .please/mcp.json (project-wide, committed to git)
 * - user: ~/.please/mcp.json (user-wide)
 */
function getConfigPath(scope: ScopeType): string {
  const home = homedir()

  switch (scope) {
    case 'project':
      return join(process.cwd(), '.please', 'mcp.json')
    case 'user':
      return join(home, '.please', 'mcp.json')
    case 'local':
    default:
      return join(process.cwd(), '.please', 'mcp.local.json')
  }
}

/**
 * Get scope display name
 */
function getScopeName(scope: ScopeType): string {
  switch (scope) {
    case 'project':
      return 'Project (.please/mcp.json)'
    case 'user':
      return 'User (~/.please/mcp.json)'
    case 'local':
    default:
      return 'Local (.please/mcp.local.json)'
  }
}

/**
 * Read existing JSON config or create empty one
 */
function readConfig(configPath: string): McpConfig {
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(content)
      return {
        mcpServers: parsed.mcpServers || {},
        ...parsed,
      }
    }
    catch {
      return { mcpServers: {} }
    }
  }
  return { mcpServers: {} }
}

/**
 * Write config to file
 */
function writeConfig(configPath: string, config: McpConfig): void {
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Get all config paths in order of precedence
 */
function getAllConfigPaths(): { scope: ScopeType, path: string }[] {
  return [
    { scope: 'local', path: getConfigPath('local') },
    { scope: 'project', path: getConfigPath('project') },
    { scope: 'user', path: getConfigPath('user') },
  ]
}

/**
 * Get all servers from all scopes
 */
function getAllServers(): Map<string, { config: McpServerConfig, scope: ScopeType, path: string }> {
  const servers = new Map<string, { config: McpServerConfig, scope: ScopeType, path: string }>()

  // Read in reverse order so local overrides project overrides user
  const configs = getAllConfigPaths().reverse()

  for (const { scope, path } of configs) {
    if (existsSync(path)) {
      const config = readConfig(path)
      for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
        servers.set(name, { config: serverConfig, scope, path })
      }
    }
  }

  return servers
}

/**
 * Create the mcp add command
 */
function createAddCommand(): Command {
  return new Command('add')
    .description('Add a new MCP server')
    .option('-t, --transport <type>', 'Transport type: stdio | http | sse', 'stdio')
    .option('-s, --scope <scope>', 'Config scope: local | project | user', 'local')
    .option('-e, --env <key=value...>', 'Environment variables')
    .argument('<name>', 'Server name')
    .argument('<command-or-url>', 'Command (for stdio) or URL (for http/sse)')
    .argument('[args...]', 'Additional arguments (for stdio transport)')
    .action(async (name: string, commandOrUrl: string, args: string[], options) => {
      const spinner = ora('Adding MCP server...').start()

      try {
        const transport = options.transport as TransportType
        const scope = options.scope as ScopeType
        const envArgs = options.env as string[] | undefined

        const configPath = getConfigPath(scope)
        const config = readConfig(configPath)

        // Check if server already exists
        if (config.mcpServers[name]) {
          warn(`Server "${name}" already exists. It will be overwritten.`)
        }

        // Build server config based on transport
        let serverConfig: McpServerConfig

        if (transport === 'http' || transport === 'sse') {
          serverConfig = {
            url: commandOrUrl,
            transport,
          }
        }
        else {
          serverConfig = {
            command: commandOrUrl,
            args: args.length > 0 ? args : undefined,
            transport: 'stdio',
          }
        }

        // Add environment variables if provided
        if (envArgs && envArgs.length > 0) {
          serverConfig.env = {}
          for (const envArg of envArgs) {
            const [key, ...valueParts] = envArg.split('=')
            if (key && valueParts.length > 0) {
              serverConfig.env[key] = valueParts.join('=')
            }
          }
        }

        // Update config
        config.mcpServers[name] = serverConfig
        writeConfig(configPath, config)

        spinner.succeed(`Added MCP server "${name}"`)
        success(`Config written to: ${configPath}`)
        info(`Scope: ${getScopeName(scope)}`)
        info(`Transport: ${transport}`)

        if (transport === 'stdio') {
          info(`Command: ${commandOrUrl}`)
          if (args.length > 0) {
            info(`Args: ${args.join(' ')}`)
          }
        }
        else {
          info(`URL: ${commandOrUrl}`)
        }

        if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
          info(`Environment: ${Object.keys(serverConfig.env).join(', ')}`)
        }
      }
      catch (err) {
        spinner.fail('Failed to add MCP server')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

/**
 * Create the mcp remove command
 */
function createRemoveCommand(): Command {
  return new Command('remove')
    .alias('rm')
    .description('Remove an MCP server')
    .option('-s, --scope <scope>', 'Config scope: local | project | user')
    .argument('<name>', 'Server name to remove')
    .action(async (name: string, options) => {
      const spinner = ora('Removing MCP server...').start()

      try {
        const scope = options.scope as ScopeType | undefined

        // If scope specified, only look in that scope
        if (scope) {
          const configPath = getConfigPath(scope)

          if (!existsSync(configPath)) {
            spinner.fail(`Config file not found: ${configPath}`)
            process.exit(1)
          }

          const config = readConfig(configPath)

          if (!config.mcpServers[name]) {
            spinner.fail(`Server "${name}" not found in ${getScopeName(scope)}`)
            process.exit(1)
          }

          delete config.mcpServers[name]
          writeConfig(configPath, config)

          spinner.succeed(`Removed MCP server "${name}" from ${getScopeName(scope)}`)
          success(`Config updated: ${configPath}`)
          return
        }

        // Otherwise, find and remove from wherever it exists
        const servers = getAllServers()
        const serverInfo = servers.get(name)

        if (!serverInfo) {
          spinner.fail(`Server "${name}" not found`)
          process.exit(1)
        }

        const config = readConfig(serverInfo.path)
        delete config.mcpServers[name]
        writeConfig(serverInfo.path, config)

        spinner.succeed(`Removed MCP server "${name}"`)
        success(`Config updated: ${serverInfo.path}`)
        info(`Scope: ${getScopeName(serverInfo.scope)}`)
      }
      catch (err) {
        spinner.fail('Failed to remove MCP server')
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

/**
 * Create the mcp list command
 */
function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List all configured MCP servers')
    .option('-s, --scope <scope>', 'Show only servers from specific scope: local | project | user')
    .option('-f, --format <format>', 'Output format: table | json', 'table')
    .action(async (options) => {
      try {
        const scope = options.scope as ScopeType | undefined
        const format = options.format as 'table' | 'json'

        let servers: Map<string, { config: McpServerConfig, scope: ScopeType, path: string }>

        if (scope) {
          // Only show servers from specified scope
          const configPath = getConfigPath(scope)
          servers = new Map()

          if (existsSync(configPath)) {
            const config = readConfig(configPath)
            for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
              servers.set(name, { config: serverConfig, scope, path: configPath })
            }
          }
        }
        else {
          servers = getAllServers()
        }

        if (servers.size === 0) {
          info('No MCP servers configured.')
          return
        }

        if (format === 'json') {
          const output: Record<string, McpServerConfig & { scope: string }> = {}
          for (const [name, { config, scope: s }] of servers) {
            output[name] = { ...config, scope: s }
          }
          console.log(JSON.stringify(output, null, 2))
          return
        }

        // Table format
        const table = new Table({
          head: [chalk.cyan('Name'), chalk.cyan('Transport'), chalk.cyan('Command/URL'), chalk.cyan('Scope')],
          colWidths: [25, 12, 50, 10],
          wordWrap: true,
          style: { head: [], border: [] },
        })

        for (const [name, { config, scope: s }] of servers) {
          const transport = config.transport || (config.url ? 'http' : 'stdio')
          const target = config.url || [config.command, ...(config.args || [])].join(' ')

          table.push([
            chalk.white(name),
            chalk.dim(transport),
            truncate(target, 45),
            chalk.dim(s),
          ])
        }

        console.log(chalk.bold(`\nConfigured MCP Servers (${servers.size})\n`))
        console.log(table.toString())
      }
      catch (err) {
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

/**
 * Create the mcp get command
 */
function createGetCommand(): Command {
  return new Command('get')
    .description('Get details of a specific MCP server')
    .option('-f, --format <format>', 'Output format: table | json', 'table')
    .argument('<name>', 'Server name')
    .action(async (name: string, options) => {
      try {
        const format = options.format as 'table' | 'json'
        const servers = getAllServers()
        const serverInfo = servers.get(name)

        if (!serverInfo) {
          error(`Server "${name}" not found`)
          process.exit(1)
        }

        const { config, scope, path } = serverInfo

        if (format === 'json') {
          console.log(JSON.stringify({ name, ...config, scope, configPath: path }, null, 2))
          return
        }

        // Table format
        console.log(chalk.bold(`\nMCP Server: ${name}\n`))

        const table = new Table({
          style: { head: [], border: [] },
          colWidths: [15, 60],
        })

        table.push(
          [chalk.cyan('Scope'), getScopeName(scope)],
          [chalk.cyan('Config'), path],
          [chalk.cyan('Transport'), config.transport || (config.url ? 'http' : 'stdio')],
        )

        if (config.url) {
          table.push([chalk.cyan('URL'), config.url])
        }
        else {
          table.push([chalk.cyan('Command'), config.command || ''])
          if (config.args && config.args.length > 0) {
            table.push([chalk.cyan('Args'), config.args.join(' ')])
          }
        }

        if (config.env && Object.keys(config.env).length > 0) {
          const envDisplay = Object.entries(config.env)
            .map(([k, v]) => `${k}=${v.substring(0, 10)}...`)
            .join('\n')
          table.push([chalk.cyan('Environment'), envDisplay])
        }

        console.log(table.toString())
      }
      catch (err) {
        error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength)
    return text
  return `${text.substring(0, maxLength - 3)}...`
}

/**
 * Create the main mcp command with subcommands
 */
export function createMcpCommand(): Command {
  const cmd = new Command('mcp')
    .description('Manage MCP server configurations')

  cmd.addCommand(createAddCommand())
  cmd.addCommand(createRemoveCommand())
  cmd.addCommand(createListCommand())
  cmd.addCommand(createGetCommand())

  return cmd
}
