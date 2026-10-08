import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['packages/dsh-plugin-host-template/src/index.ts'],
    outDir: 'packages/dsh-plugin-host-template/dist',
    format: 'esm',
    target: 'es2024',
    external: ['@deepseek-ai/*'],
    dts: false,
  },
  {
    entry: ['packages/dsh-plugin-client-template/src/host.ts'],
    outDir: 'packages/dsh-plugin-client-template/dist',
    format: 'esm',
    target: 'es2024',
    dts: false,
  },
  {
    entry: ['packages/dsh-plugin-client-template/src/index.ts'],
    outDir: 'packages/dsh-plugin-client-template/dist',
    format: 'cjs',
    target: 'es2024',
    dts: false,
  },
])
