import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 支持 workspace 模式覆盖双包
    include: ['packages/*/src/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts'],
    globals: true,
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
    // 为不同包配置不同的测试环境
    environmentMatchGlob: [
      ['packages/dsh-plugin-client-template/**', 'jsdom'],
      ['packages/dsh-plugin-host-template/**', 'node'],
    ],
  },
  resolve: {
    alias: {
      // 模拟 @deepseek-ai 包路径
      '@deepseek-ai/cordis': '/types/deepseek-ai.d.ts',
      '@deepseek-ai/dsh-host-webserver': '/types/deepseek-ai.d.ts',
      '@deepseek-ai/dsh-client-runtime/client': '/types/deepseek-ai.d.ts',
    },
  },
})
