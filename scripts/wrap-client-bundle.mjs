#!/usr/bin/env node
/**
 * 客户端 bundle 注册包装（DSH 客户端模块系统格式）
 *
 * tsdown 无法输出尾部包装，因此构建完成后把 dist/index.cjs
 * 拼装成 DSH 要求的自注册格式：
 *
 *   window.__ModuleLoader__.load({
 *     id: "<包名>",
 *     factory: (require) => {
 *       var module = { exports: {} };
 *       var exports = module.exports;
 *       ...CJS 主体...
 *       return module.exports;
 *     }
 *   });
 *
 * 与 @deepseek-ai 官方客户端 bundle（如 dsh-client-runtime/lib/client.js）格式一致。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-plugin-client-template'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE_PATH = join(ROOT, 'packages', 'dsh-plugin-client-template', 'dist', 'index.cjs')

const raw = readFileSync(BUNDLE_PATH, 'utf8').trim()
if (raw.includes('window.__ModuleLoader__.load(')) {
  console.warn('[wrap-client-bundle] bundle 已包含注册包装，跳过')
  process.exit(0)
}

const wrapped = [
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(PACKAGE_NAME)},`,
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  raw.split('\n').map((line) => `    ${line}`).join('\n'),
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n')

writeFileSync(BUNDLE_PATH, wrapped)
console.log(`[wrap-client-bundle] 已写入注册包装: ${BUNDLE_PATH}`)
