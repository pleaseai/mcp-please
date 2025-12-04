#!/usr/bin/env bun

/**
 * Build release binaries for all platforms using Bun's compile feature.
 *
 * Usage:
 *   bun scripts/build-release.ts [version]
 *
 * If version is not provided, it will be read from packages/mcp/package.json
 */

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const BINARY_NAME = 'mcp-gateway'
const ENTRY_POINT = 'packages/mcp/src/cli.ts'
const OUTPUT_DIR = 'dist/release'

type BunTarget = 'bun-darwin-arm64' | 'bun-darwin-x64' | 'bun-linux-arm64' | 'bun-linux-x64'

const TARGETS: Array<{ os: string, arch: string, target: BunTarget }> = [
  { os: 'darwin', arch: 'arm64', target: 'bun-darwin-arm64' },
  { os: 'darwin', arch: 'x64', target: 'bun-darwin-x64' },
  { os: 'linux', arch: 'arm64', target: 'bun-linux-arm64' },
  { os: 'linux', arch: 'x64', target: 'bun-linux-x64' },
]

async function generateChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const buffer = await file.arrayBuffer()
  const hash = new Bun.CryptoHasher('sha256')
  hash.update(buffer)
  return hash.digest('hex')
}

async function main() {
  const pkg = await Bun.file('packages/mcp/package.json').json()
  console.log(`Building release binaries v${pkg.version}`)
  console.log(`Output directory: ${OUTPUT_DIR}`)
  console.log()

  // Clean and create output directory
  await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(OUTPUT_DIR, { recursive: true })

  const checksums: string[] = []

  for (const { os, arch, target } of TARGETS) {
    const binaryName = `${BINARY_NAME}-${os}-${arch}`
    const outfile = join(OUTPUT_DIR, binaryName)

    console.log(`Building for ${os} ${arch}...`)

    const result = await Bun.build({
      entrypoints: [ENTRY_POINT],
      minify: true,
      sourcemap: 'linked',
      compile: {
        target,
        outfile,
      },
    })

    if (!result.success) {
      console.error(`  ✗ Build failed for ${os} ${arch}`)
      for (const log of result.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    console.log(`  ✓ Created ${binaryName}`)

    // Generate checksum and write individual .sha256 file
    const checksum = await generateChecksum(outfile)
    const checksumLine = `${checksum}  ${binaryName}`
    checksums.push(checksumLine)

    // Write individual checksum file for homebrew formula
    const checksumFilePath = `${outfile}.sha256`
    await Bun.write(checksumFilePath, `${checksumLine}\n`)

    console.log(`  ✓ SHA256: ${checksum.slice(0, 16)}...`)
  }

  // Write combined checksums file
  const checksumsPath = join(OUTPUT_DIR, 'checksums.txt')
  await Bun.write(checksumsPath, `${checksums.join('\n')}\n`)
  console.log()
  console.log('Checksums:')
  console.log(checksums.join('\n'))

  console.log()
  console.log('Build complete!')

  // List files with sizes
  const files = await Array.fromAsync(new Bun.Glob('*').scan(OUTPUT_DIR))
  console.log()
  console.log('Release artifacts:')
  for (const file of files.sort()) {
    const stat = Bun.file(join(OUTPUT_DIR, file)).size
    const sizeMB = (stat / 1024 / 1024).toFixed(2)
    console.log(`  ${file} (${sizeMB} MB)`)
  }
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
