#!/usr/bin/env bun

/**
 * Update Homebrew formula with new version and checksums.
 *
 * Usage:
 *   bun scripts/update-formula.ts <version> <homebrew-tap-path>
 *
 * Example:
 *   bun scripts/update-formula.ts v0.1.0 ../homebrew-tap
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const REPO = 'pleaseai/mcp-gateway'

interface Checksums {
  darwinX64: string
  darwinArm64: string
  linuxX64: string
  linuxArm64: string
}

async function downloadChecksum(version: string, platform: string): Promise<string> {
  const url = `https://github.com/${REPO}/releases/download/${version}/mcp-gateway-${platform}.sha256`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download checksum for ${platform}: ${response.statusText}`)
  }

  const content = await response.text()
  return content.split(/\s+/)[0]
}

async function downloadChecksums(version: string): Promise<Checksums> {
  console.log('Downloading checksums...')

  const [darwinX64, darwinArm64, linuxX64, linuxArm64] = await Promise.all([
    downloadChecksum(version, 'darwin-x64'),
    downloadChecksum(version, 'darwin-arm64'),
    downloadChecksum(version, 'linux-x64'),
    downloadChecksum(version, 'linux-arm64'),
  ])

  console.log('Checksums:')
  console.log(`  darwin-x64:   ${darwinX64.slice(0, 16)}...`)
  console.log(`  darwin-arm64: ${darwinArm64.slice(0, 16)}...`)
  console.log(`  linux-x64:    ${linuxX64.slice(0, 16)}...`)
  console.log(`  linux-arm64:  ${linuxArm64.slice(0, 16)}...`)

  return { darwinX64, darwinArm64, linuxX64, linuxArm64 }
}

function generateFormula(version: string, checksums: Checksums): string {
  const versionNoV = version.replace(/^v/, '')

  return `class McpGateway < Formula
  desc "MCP server and CLI for searching tools using regex, BM25, or semantic search"
  homepage "https://github.com/pleaseai/mcp-gateway"
  version "${versionNoV}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/pleaseai/mcp-gateway/releases/download/${version}/mcp-gateway-darwin-arm64"
      sha256 "${checksums.darwinArm64}"
    else
      url "https://github.com/pleaseai/mcp-gateway/releases/download/${version}/mcp-gateway-darwin-x64"
      sha256 "${checksums.darwinX64}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/pleaseai/mcp-gateway/releases/download/${version}/mcp-gateway-linux-arm64"
      sha256 "${checksums.linuxArm64}"
    else
      url "https://github.com/pleaseai/mcp-gateway/releases/download/${version}/mcp-gateway-linux-x64"
      sha256 "${checksums.linuxX64}"
    end
  end

  def install
    if OS.mac?
      if Hardware::CPU.arm?
        bin.install "mcp-gateway-darwin-arm64" => "mcp-gateway"
      else
        bin.install "mcp-gateway-darwin-x64" => "mcp-gateway"
      end
    else
      if Hardware::CPU.arm?
        bin.install "mcp-gateway-linux-arm64" => "mcp-gateway"
      else
        bin.install "mcp-gateway-linux-x64" => "mcp-gateway"
      end
    end
  end

  test do
    assert_match version.to_s, shell_output("\#{bin}/mcp-gateway --version")
  end
end
`
}

function usage(): never {
  console.log('Usage: bun scripts/update-formula.ts <version> <homebrew-tap-path>')
  console.log('')
  console.log('Arguments:')
  console.log('  version           Release version (e.g., v0.1.0)')
  console.log('  homebrew-tap-path Path to homebrew-tap repository')
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    usage()
  }

  let version = args[0]
  const tapPath = args[1]

  // Validate version format
  if (!/^v?\d+\.\d+\.\d+/.test(version)) {
    console.error(`ERROR: Invalid version format: ${version}`)
    process.exit(1)
  }

  // Ensure version starts with 'v'
  if (!version.startsWith('v')) {
    version = `v${version}`
  }

  // Validate tap path
  if (!existsSync(tapPath)) {
    console.error(`ERROR: Homebrew tap path does not exist: ${tapPath}`)
    process.exit(1)
  }

  console.log(`Updating formula for version ${version}`)

  const checksums = await downloadChecksums(version)
  const formula = generateFormula(version, checksums)

  const formulaPath = join(tapPath, 'mcp-gateway.rb')
  await Bun.write(formulaPath, formula)

  console.log(`Formula updated: ${formulaPath}`)
  console.log('Done!')
}

main().catch((err) => {
  console.error('Failed:', err.message)
  process.exit(1)
})
