import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/**
 * Ensure entries are in .please/.gitignore
 */
export function ensurePleaseGitignore(entries: string[]): void {
  const gitignorePath = join(process.cwd(), '.please', '.gitignore')

  let content = ''
  let existingLines: string[] = []

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8')
    existingLines = content.split('\n').map(line => line.trim())
  }
  else {
    // Ensure .please directory exists
    const dir = dirname(gitignorePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // Find entries that need to be added
  const entriesToAdd = entries.filter(entry => !existingLines.includes(entry))

  if (entriesToAdd.length === 0) {
    return
  }

  // Append entries
  let newContent = content
  for (const entry of entriesToAdd) {
    newContent = newContent.endsWith('\n') || newContent === ''
      ? `${newContent}${entry}\n`
      : `${newContent}\n${entry}\n`
  }

  writeFileSync(gitignorePath, newContent)
}
