import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'es2024',
  external: ['@deepseek-ai/*'],
  dts: false,
})
