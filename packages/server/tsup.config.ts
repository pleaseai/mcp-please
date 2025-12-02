import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false, // Skip DTS due to complex MCP SDK types causing TS2589
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
})
