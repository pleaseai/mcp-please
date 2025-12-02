import type { SearchResult, ToolReference } from '@pleaseai/mcp-core'
import chalk from 'chalk'
import Table from 'cli-table3'

/**
 * Output format options
 */
export type OutputFormat = 'table' | 'json' | 'minimal'

/**
 * Format search results based on output format
 */
export function formatSearchResults(result: SearchResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2)

    case 'minimal':
      return result.tools.map(t => t.name).join('\n')

    case 'table':
    default:
      return formatTable(result)
  }
}

/**
 * Format results as a table
 */
function formatTable(result: SearchResult): string {
  const lines: string[] = []

  // Header
  lines.push(chalk.bold(`Search Results for "${result.query}" (${result.mode} mode)`))
  lines.push(chalk.dim(`Found ${result.tools.length} of ${result.totalIndexed} tools in ${result.searchTimeMs}ms`))
  lines.push('')

  if (result.tools.length === 0) {
    lines.push(chalk.yellow('No matching tools found.'))
    return lines.join('\n')
  }

  // Table
  const table = new Table({
    head: [chalk.cyan('#'), chalk.cyan('Name'), chalk.cyan('Description'), chalk.cyan('Score')],
    colWidths: [4, 30, 60, 8],
    wordWrap: true,
    style: { head: [], border: [] },
  })

  result.tools.forEach((tool, index) => {
    table.push([
      chalk.dim(String(index + 1)),
      chalk.white(tool.name),
      truncate(tool.description, 100),
      formatScore(tool.score),
    ])
  })

  lines.push(table.toString())

  return lines.join('\n')
}

/**
 * Format score with color coding
 */
function formatScore(score: number): string {
  const percentage = Math.round(score * 100)

  if (percentage >= 80) {
    return chalk.green(`${percentage}%`)
  }
  else if (percentage >= 50) {
    return chalk.yellow(`${percentage}%`)
  }
  else {
    return chalk.dim(`${percentage}%`)
  }
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
 * Format tool reference for display
 */
export function formatToolReference(tool: ToolReference): string {
  return `${chalk.bold(tool.name)} (${formatScore(tool.score)})\n  ${chalk.dim(tool.description)}`
}

/**
 * Print success message
 */
export function success(message: string): void {
  console.log(`${chalk.green('✓')} ${message}`)
}

/**
 * Print error message
 */
export function error(message: string): void {
  console.error(`${chalk.red('✗')} ${message}`)
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  console.warn(`${chalk.yellow('⚠')} ${message}`)
}

/**
 * Print info message
 */
export function info(message: string): void {
  console.log(`${chalk.blue('ℹ')} ${message}`)
}
