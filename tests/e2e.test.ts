/**
 * dsh-fortress 卡 8：端到端测试
 *
 * 设计原则：
 *   - 直接动态 import 真实插件源码 packages/dsh-plugin-host-template/src/index.ts，
 *     不复制、不重写任何判定逻辑（导出仅供测试驱动，见 index.ts 里的 export 注释）。
 *   - 不依赖 DSH 运行时：用一个假 ctx 调 apply() 拿到真实的 tools.guard 回调，
 *     再用真实的 exec 形状（{ name, arguments }）喂给它。
 *   - 零第三方依赖：只用 node:assert / node:fs / node:path，纯 Node 环境跑。
 *
 * 运行：node --experimental-strip-types tests/e2e.test.ts
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// 迷你测试框架
// ---------------------------------------------------------------------------

let passed = 0
const failures: string[] = []

function group(title: string): void {
  console.log(`\n── ${title}`)
}

function check(id: string, description: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${id} ${description}`)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    failures.push(`[${id}] ${description}\n      ${raw.split('\n').join('\n      ')}`)
    console.log(`  ✗ ${id} ${description}`)
  }
}

// ---------------------------------------------------------------------------
// 载入真实模块
// ---------------------------------------------------------------------------

interface FortressConfig {
  rulesText: string
  protectedPaths: string[]
  protectedRemovalPatterns: Array<{ keywords: string[] }>
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
  CONFIG_PATH: string
  DEFAULT_CONFIG: FortressConfig
  loadConfig: (configPath?: string) => FortressConfig
  isProtectedRemoval: (command: string) => boolean
  isProtectedPath: (raw: unknown) => boolean
  isProtectedPathModification: (command: string) => boolean
}

type GuardExec = { name?: unknown; arguments?: unknown }
type Guard = (exec: GuardExec | undefined) => string | undefined

const MODULE_URL = new URL(
  '../packages/dsh-plugin-host-template/src/index.ts',
  import.meta.url,
).href

const mod = (await import(MODULE_URL)) as PluginModule
assert.equal(mod.name, 'dsh-plugin-host-template', '模块应导出插件名')

const DEV_DIR = '/Users/liuzhaoyang/dsh-fortress-dev'

// ---------------------------------------------------------------------------
// 用假 ctx 跑真实 apply()，抓出真实的 guard 回调
// ---------------------------------------------------------------------------

let guard: Guard | undefined
let sectionText: string | undefined
let sectionOrder: number | undefined

function fakeContext(): unknown {
  return {
    // webServer 不存在 -> apply() 跳过 HTTP 路由注册
    get: () => undefined,
    // effect 立即执行回调：guard / systemPrompt section 都是在这里注册的
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    tools: {
      guard: (fn: Guard) => {
        guard = fn
        return () => {}
      },
    },
    systemPrompt: {
      // 顺序锚点必须存在，否则 resolveRulesOrder 会抛错
      getSectionOrder: (section: string) => (section === 'DEPLOYMENT_PERSONA_SUFFIX' ? 100 : undefined),
      section: (value: { text: string; order: number }) => {
        sectionText = value.text
        sectionOrder = value.order
        return () => {}
      },
    },
  }
}

mod.apply(fakeContext())

const liveGuard: Guard = guard ?? (() => {
  throw new Error('apply() 没有注册 tools.guard 回调（假 ctx 形状可能过时了）')
})

/** 调用 guard，并临时静音 guard 内部的 console.log 噪声 */
function askGuard(exec: GuardExec | undefined): string | undefined {
  const original = console.log
  console.log = () => {}
  try {
    return liveGuard(exec)
  } finally {
    console.log = original
  }
}

function bashExec(command: unknown): GuardExec {
  return { name: 'bash', arguments: { command } }
}

// ---------------------------------------------------------------------------
// 临时配置文件
// ---------------------------------------------------------------------------

const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-fortress-e2e-'))
const tmpConfig = (fileName: string, body: string): string => {
  const file = join(tmpDir, fileName)
  writeFileSync(file, body, 'utf8')
  return file
}

// ===========================================================================
// 1-4 配置读取（纯逻辑，不碰 DSH 运行时）
// ===========================================================================

group('1-4 配置读取（loadConfig）')

check('1', '没有 config.json -> 用默认守则文本', () => {
  const config = mod.loadConfig(join(tmpDir, 'not-there.json'))
  assert.equal(config.rulesText, mod.DEFAULT_CONFIG.rulesText)
  assert.deepEqual(config, mod.DEFAULT_CONFIG)
})

check('2', 'config.json 的 rulesText 自定义 -> 用自定义值', () => {
  const custom = {
    rulesText: 'CARD8-CUSTOM-RULES',
    protectedPaths: ['/tmp/card8-protected'],
    protectedRemovalPatterns: [{ keywords: ['rm', 'CARD8-MARKER'] }],
  }
  const config = mod.loadConfig(tmpConfig('custom.json', JSON.stringify(custom)))
  assert.equal(config.rulesText, 'CARD8-CUSTOM-RULES')
  assert.deepEqual(config.protectedPaths, ['/tmp/card8-protected'])
  assert.deepEqual(config.protectedRemovalPatterns, [{ keywords: ['rm', 'CARD8-MARKER'] }])
})

check('3', 'config.json 是坏 JSON -> 全部回退默认值', () => {
  const config = mod.loadConfig(tmpConfig('broken.json', '{ "rulesText": '))
  assert.deepEqual(config, mod.DEFAULT_CONFIG)
})

check('4', 'config.json 缺 rulesText -> 该字段回退，其他字段仍生效', () => {
  const config = mod.loadConfig(
    tmpConfig('partial.json', JSON.stringify({ protectedPaths: ['/tmp/card8-protected'] })),
  )
  assert.equal(config.rulesText, mod.DEFAULT_CONFIG.rulesText)
  assert.deepEqual(config.protectedPaths, ['/tmp/card8-protected'])
  assert.deepEqual(config.protectedRemovalPatterns, mod.DEFAULT_CONFIG.protectedRemovalPatterns)
})

check('4b', '真实 config.json 的 rulesText 确实进了 systemPrompt 段', () => {
  const live: FortressConfig = mod.loadConfig(mod.CONFIG_PATH)
  assert.equal(sectionText, live.rulesText)
  assert.ok(typeof sectionOrder === 'number', `section order 应为数字，实际 ${String(sectionOrder)}`)
})

// ===========================================================================
// 5-10 删除语义识别（经真实 guard 回调 + 导出函数双路验证）
// ===========================================================================

group('5-10 删除语义识别（bash 命令）')

const removalCases: Array<{ id: string; command: string; blocked: boolean }> = [
  { id: '5', command: 'dsh plugin --profile web remove dsh-fortress', blocked: true },
  { id: '6', command: 'dsh plugin --profile web list', blocked: false },
  { id: '7', command: 'pnpm remove dsh-fortress', blocked: true },
  { id: '8', command: 'npm uninstall dsh-fortress', blocked: true },
  { id: '9', command: 'pnpm install dsh-fortress', blocked: false },
  { id: '10', command: '', blocked: false },
]

for (const item of removalCases) {
  const label = item.command === '' ? '空字符串' : JSON.stringify(item.command)
  check(item.id, `${label} -> ${item.blocked ? '拦' : '放行'}`, () => {
    assert.equal(
      mod.isProtectedRemoval(item.command),
      item.blocked,
      `isProtectedRemoval('${item.command}') 期望 ${item.blocked}`,
    )
    const result = askGuard(bashExec(item.command))
    if (item.blocked) {
      assert.equal(result, 'blocked: protected tool removal')
    } else {
      assert.equal(result, undefined, `guard 应放行，实际返回 ${JSON.stringify(result)}`)
    }
  })
}

// ===========================================================================
// 11-15 路径保护（bash 命令级）
// ===========================================================================

group('11-15 路径保护（bash 命令级）')

const bashPathCases: Array<{ id: string; command: string; blocked: boolean }> = [
  { id: '11', command: `rm -rf ${DEV_DIR}/foo`, blocked: true },
  { id: '12', command: `cp /tmp/x ${DEV_DIR}/y`, blocked: true },
  { id: '13', command: `cp ${DEV_DIR}/x /tmp/y`, blocked: false },
  { id: '14', command: `ls ${DEV_DIR}`, blocked: false },
  { id: '15', command: `cat ${DEV_DIR}/config.json`, blocked: false },
]

for (const item of bashPathCases) {
  check(item.id, `${JSON.stringify(item.command)} -> ${item.blocked ? '拦' : '放行'}`, () => {
    assert.equal(
      mod.isProtectedPathModification(item.command),
      item.blocked,
      `isProtectedPathModification 期望 ${item.blocked}`,
    )
    const result = askGuard(bashExec(item.command))
    if (item.blocked) {
      assert.equal(result, 'blocked: protected path modification')
    } else {
      assert.equal(result, undefined, `guard 应放行，实际返回 ${JSON.stringify(result)}`)
    }
  })
}

// ===========================================================================
// 16-19 路径保护（文件工具）
// ===========================================================================

group('16-19 路径保护（write / read / edit 工具）')

const fileToolCases: Array<{ id: string; exec: GuardExec; path: string; blocked: boolean }> = [
  {
    id: '16',
    exec: { name: 'write', arguments: { path: `${DEV_DIR}/foo.txt` } },
    path: `${DEV_DIR}/foo.txt`,
    blocked: true,
  },
  {
    id: '17',
    exec: { name: 'write', arguments: { path: '/tmp/foo.txt' } },
    path: '/tmp/foo.txt',
    blocked: false,
  },
  {
    id: '18',
    exec: { name: 'read', arguments: { path: `${DEV_DIR}/config.json` } },
    path: `${DEV_DIR}/config.json`,
    blocked: false,
  },
  {
    id: '19',
    exec: { name: 'edit', arguments: { path: `${DEV_DIR}/foo.txt` } },
    path: `${DEV_DIR}/foo.txt`,
    blocked: true,
  },
]

// read 不在 guard 管辖范围内：路径受保护也照样放行（见第 18 条语义说明）
const EXPECTED_PATH_PROTECTED: Record<string, boolean> = { '16': true, '17': false, '18': true, '19': true }

for (const item of fileToolCases) {
  check(item.id, `${item.exec.name} ${item.path} -> ${item.blocked ? '拦' : '放行'}`, () => {
    const result = askGuard(item.exec)
    if (item.blocked) {
      assert.equal(result, 'blocked: protected path modification')
      assert.equal(mod.isProtectedPath(item.path), EXPECTED_PATH_PROTECTED[item.id])
    } else {
      assert.equal(result, undefined, `guard 应放行，实际返回 ${JSON.stringify(result)}`)
      assert.equal(mod.isProtectedPath(item.path), EXPECTED_PATH_PROTECTED[item.id])
    }
  })
}

// ===========================================================================
// 20-22 畸形输入：不抛错、一律放行
// ===========================================================================

group('20-22 畸形输入（不抛错、放行）')

const malformedCases: Array<{ id: string; exec: GuardExec | undefined }> = [
  { id: '20', exec: undefined },
  { id: '21', exec: { name: 'bash' } },
  { id: '22', exec: { name: 'bash', arguments: { command: 123 } } },
]

for (const item of malformedCases) {
  const label = item.exec === undefined ? 'exec = undefined' : JSON.stringify(item.exec)
  check(item.id, `${label} -> 放行且不抛错`, () => {
    const result = askGuard(item.exec)
    assert.equal(result, undefined, `应放行，实际返回 ${JSON.stringify(result)}`)
  })
}

// ===========================================================================
// 收尾
// ===========================================================================

rmSync(tmpDir, { recursive: true, force: true })

const total = passed + failures.length
console.log(`\n${failures.length === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed}/${total} 条`)

if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const failure of failures) console.log(`  - ${failure}`)
  console.log(`\n提示：第 5-19 条依赖 ${mod.CONFIG_PATH} 里的受保护路径/规则；配置被改过就先恢复默认（见 TESTING.md）。`)
  process.exitCode = 1
}
