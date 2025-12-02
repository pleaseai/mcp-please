import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    server: 'src/server.ts',
  },
  format: ['esm'],
  // Disable dts due to complex zod types in MCP SDK registerTool
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  banner: ({ entryPointName }) => ({
    js: entryPointName === 'cli' ? '#!/usr/bin/env node' : '',
  }),
})
