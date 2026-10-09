import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 卡 8 起为单包，测试源只可能在 src/ 下
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    globals: true,
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
    environment: 'node',
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
