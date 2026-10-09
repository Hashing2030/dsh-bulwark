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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  isProtectedPath: (raw: unknown, pathsOverride?: string[]) => boolean
  isProtectedPathModification: (command: string, pathsOverride?: string[]) => boolean
  reloadConfig: (configPath?: string) => boolean
  getRulesText: () => string
  getProtectedPaths: () => string[]
  getProtectedPathPrefixes: () => string[]
  __getConfigForTest: () => FortressConfig
  __setConfigForTest: (patch: Partial<FortressConfig>) => void
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
// apply() 里 ctx.effect() 返回的 disposer，跑完统一释放（含配置热重载 watcher）
const effects: Array<() => void> = []

function fakeContext(): unknown {
  return {
    // webServer 不存在 -> apply() 跳过 HTTP 路由注册
    get: () => undefined,
    // effect 立即执行回调：guard / systemPrompt section 都是在这里注册的
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') effects.push(disposer as () => void)
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
// 24-31 保护任意路径（protectedPaths 覆盖）
// ===========================================================================

group('24-31 保护任意路径（protectedPaths 覆盖）')

// 这 8 条验证「config.protectedPaths 里放任意路径都生效」，通过 isProtectedPath /
// isProtectedPathModification 的可选参数注入不同清单，不动真实 config.json
// （守卫 tools.guard 用模块加载时的 CONFIG，其接线由第 16-19 条覆盖）。
// 先造出真实文件 / 目录：这样 normalizePath 的 realpathSync 分支也被走到；
// 第 31 条反过来专门覆盖「路径不存在 -> realpathSync 失败回退 resolve」那条分支。

const WILD_FILE = '/tmp/xxx.txt'
const WILD_DIR = '/tmp/xxx-dir'
const WILD_DIR2 = '/tmp/xxx-dir2'
const WILD_DIR2_FILE = '/tmp/xxx-dir2/a.txt'
const WILD_CASE_DIR = '/tmp/XXX-dir'
const WILD_MULTI_A = '/tmp/a'
const WILD_MULTI_B = '/tmp/b'
const WILD_MULTI_B_FILE = '/tmp/b/x.txt'
const WILD_MISSING_DIR = '/tmp/zzz'

const WILD_DIRS = [WILD_DIR, WILD_DIR2, WILD_CASE_DIR, WILD_MULTI_A, WILD_MULTI_B]

function prepareWildcards(): void {
  for (const dir of WILD_DIRS) rmSync(dir, { recursive: true, force: true })
  rmSync(WILD_FILE, { force: true })
  writeFileSync(WILD_FILE, 'dsh-fortress 测试夹具\n', 'utf8')
  mkdirSync(join(WILD_DIR, 'sub'), { recursive: true })
  writeFileSync(join(WILD_DIR, 'a.txt'), '', 'utf8')
  writeFileSync(join(WILD_DIR, 'sub', 'b.txt'), '', 'utf8')
  mkdirSync(WILD_DIR2, { recursive: true })
  writeFileSync(WILD_DIR2_FILE, '', 'utf8')
  mkdirSync(WILD_CASE_DIR, { recursive: true })
  mkdirSync(WILD_MULTI_B, { recursive: true })
  writeFileSync(WILD_MULTI_B_FILE, '', 'utf8')
}

function removeWildcards(): void {
  rmSync(WILD_FILE, { force: true })
  for (const dir of WILD_DIRS) rmSync(dir, { recursive: true, force: true })
}

prepareWildcards()

try {
  check('24', 'paths 含 /tmp/xxx.txt，write /tmp/xxx.txt -> 拦', () => {
    assert.equal(mod.isProtectedPath(WILD_FILE, [WILD_FILE]), true)
    assert.equal(mod.isProtectedPathModification(`rm ${WILD_FILE}`, [WILD_FILE]), true)
  })

  check('25', 'paths 不含 /tmp/yyy.txt，write /tmp/yyy.txt -> 放行', () => {
    assert.equal(mod.isProtectedPath('/tmp/yyy.txt', [WILD_FILE, WILD_DIR]), false)
    assert.equal(
      mod.isProtectedPathModification('rm /tmp/yyy.txt', [WILD_FILE, WILD_DIR]),
      false,
    )
  })

  check('26', 'paths 含 /tmp/xxx-dir，write /tmp/xxx-dir/a.txt -> 拦', () => {
    assert.equal(mod.isProtectedPath(join(WILD_DIR, 'a.txt'), [WILD_DIR]), true)
  })

  check('27', 'paths 含 /tmp/xxx-dir，write /tmp/xxx-dir/sub/b.txt -> 拦（嵌套）', () => {
    assert.equal(mod.isProtectedPath(join(WILD_DIR, 'sub', 'b.txt'), [WILD_DIR]), true)
  })

  check('28', 'paths 含 /tmp/xxx-dir，write /tmp/xxx-dir2/a.txt -> 放行（兄弟目录不误伤）', () => {
    assert.equal(mod.isProtectedPath(WILD_DIR2_FILE, [WILD_DIR]), false)
  })

  check('29', 'paths 含 /tmp/XXX-dir，write /tmp/xxx-dir/a.txt -> 拦（大小写不敏感）', () => {
    assert.equal(mod.isProtectedPath(join(WILD_DIR, 'a.txt'), [WILD_CASE_DIR]), true)
  })

  check('30', 'paths 含 /tmp/a 和 /tmp/b，write /tmp/b/x.txt -> 拦（多路径并存）', () => {
    assert.equal(mod.isProtectedPath(WILD_MULTI_B_FILE, [WILD_MULTI_A, WILD_MULTI_B]), true)
    assert.equal(mod.isProtectedPath(WILD_MULTI_A, [WILD_MULTI_A, WILD_MULTI_B]), true)
  })

  check('31', 'paths 含 /tmp/zzz，write /tmp/zzz/nonexistent.txt -> 拦（回退 resolve）', () => {
    assert.equal(existsSync(WILD_MISSING_DIR), false, `${WILD_MISSING_DIR} 不存在，本用例才成立`)
    assert.equal(
      mod.isProtectedPath(join(WILD_MISSING_DIR, 'nonexistent.txt'), [WILD_MISSING_DIR]),
      true,
    )
  })
} finally {
  removeWildcards()
}

// ============================================================
// 32-36 卡 1：配置热重载（getter + reloadConfig）
// ============================================================

group('32-36 配置热重载')

/** 与 index.ts normalizePath() 对齐：realpath 优先，失败回退 resolve，统一小写。 */
function normalizePathLike(raw: string): string {
  try {
    return realpathSync(raw).toLowerCase()
  } catch {
    return resolve(raw).toLowerCase()
  }
}

check('32', 'getRulesText() 返回当前 CONFIG.rulesText', () => {
  const current = mod.__getConfigForTest()
  assert.equal(mod.getRulesText(), current.rulesText)
  assert.ok(mod.getRulesText().length > 0, 'rulesText 不应为空')
})

check('33', 'CONFIG.rulesText 变更后 getRulesText() 返回新值', () => {
  const original = mod.__getConfigForTest().rulesText
  try {
    mod.__setConfigForTest({ rulesText: 'HOT-RELOAD-MARKER' })
    assert.equal(mod.getRulesText(), 'HOT-RELOAD-MARKER')
  } finally {
    mod.__setConfigForTest({ rulesText: original })
  }
  assert.equal(mod.getRulesText(), original, 'rulesText 应已恢复')
})

check('34', 'getProtectedPaths() 返回当前 CONFIG.protectedPaths', () => {
  const current = mod.__getConfigForTest()
  assert.deepEqual(mod.getProtectedPaths(), current.protectedPaths)
  assert.ok(mod.getProtectedPaths().length > 0, 'protectedPaths 不应为空')
})

check('35', '坏 JSON 不改变 CONFIG（重载失败保留旧值）', () => {
  const before = mod.__getConfigForTest()
  const broken = tmpConfig('hot-reload-broken.json', '{ "rulesText": ')
  const originalLog = console.log
  let ok = true
  try {
    console.log = () => {}
    ok = mod.reloadConfig(broken)
  } finally {
    console.log = originalLog
  }
  assert.equal(ok, false, 'reloadConfig(坏 JSON) 应返回 false')
  assert.equal(mod.getRulesText(), before.rulesText, 'rulesText 应保留旧值')
  assert.deepEqual(mod.__getConfigForTest().protectedPaths, before.protectedPaths)
})

check('36', 'getProtectedPathPrefixes() 归一化后能匹配 /Users/liuzhaoyang/dsh-fortress-dev', () => {
  const original = mod.__getConfigForTest().protectedPaths
  try {
    mod.__setConfigForTest({ protectedPaths: [DEV_DIR] })
    const prefixes = mod.getProtectedPathPrefixes()
    const expected = normalizePathLike(DEV_DIR)
    assert.ok(
      prefixes.includes(expected),
      `prefixes ${JSON.stringify(prefixes)} 应包含 ${expected}`,
    )
    assert.equal(mod.isProtectedPath(join(DEV_DIR, 'config.json')), true)
  } finally {
    mod.__setConfigForTest({ protectedPaths: original })
    mod.getProtectedPathPrefixes()
  }
})

// ===========================================================================
// 37-46 卡 3：tokenizer 接入（引号感知 / 包装器解包 / bash -c 递归）
// ===========================================================================

group('37-46 卡 3：tokenizer 接入')

// 37-44 / 46：路径保护判定（isProtectedPathModification + 真实 guard 双路验证）
const tokenizerPathCases: Array<{ id: string; command: string; blocked: boolean; label: string }> = [
  { id: '37', command: 'echo "rm /path"', blocked: false, label: '引号内 rm 不算动词 -> 放行' },
  {
    id: '38',
    command: `sudo rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'sudo 包装器解包 -> 拦',
  },
  {
    id: '39',
    command: `env FOO=bar rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'env VAR=value 包装器解包 -> 拦',
  },
  {
    id: '40',
    command: `command rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'command 包装器解包 -> 拦',
  },
  {
    id: '41',
    command: `bash -c 'rm -rf ${DEV_DIR}/foo'`,
    blocked: true,
    label: 'bash -c 递归解析 -> 拦',
  },
  {
    id: '42',
    command: `bash -c 'echo "rm /path"'`,
    blocked: false,
    label: 'bash -c 内层引号内 rm -> 放行',
  },
  {
    id: '43',
    command: `nohup rm ${DEV_DIR}/foo`,
    blocked: true,
    label: 'nohup 包装器解包 -> 拦',
  },
  { id: '44', command: `echo 'a && b'`, blocked: false, label: '引号内分隔符不切段 -> 放行' },
  {
    id: '46',
    command: `bash -c 'bash -c "rm ${DEV_DIR}/foo"'`,
    blocked: true,
    label: 'bash -c 两层嵌套 -> 拦',
  },
]

for (const item of tokenizerPathCases) {
  check(item.id, `${item.label}（${JSON.stringify(item.command)}）`, () => {
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

// 45：包装器 + 删除语义（走 isProtectedRemoval 分支）
check('45', `sudo dsh plugin --profile web remove dsh-fortress -> 拦（包装器 + 删除）`, () => {
  assert.equal(mod.isProtectedRemoval('sudo dsh plugin --profile web remove dsh-fortress'), true)
  const result = askGuard(bashExec('sudo dsh plugin --profile web remove dsh-fortress'))
  assert.equal(result, 'blocked: protected tool removal')
})

// ===========================================================================
// 47-61 卡 4：写入动词扩展（sudo 选项 / 重定向 / dd / truncate / tee / 内联脚本）
// ===========================================================================

group('47-61 卡 4：写入动词扩展')

// 每条都走 isProtectedPathModification + 真实 guard 双路验证，与 37-44 的检查方式一致
const writingVerbCases: Array<{ id: string; command: string; blocked: boolean; label: string }> = [
  {
    id: '47',
    command: `sudo -u root rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'sudo 带值选项 -u root 后取到 rm -> 拦',
  },
  {
    id: '48',
    command: `sudo -u root -H rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'sudo 带值选项 + 无值选项 -H -> 拦',
  },
  {
    id: '49',
    command: `sudo -u root ls ${DEV_DIR}`,
    blocked: false,
    label: 'sudo 选项之后是只读动词 -> 放行',
  },
  {
    id: '50',
    command: `echo hi > ${DEV_DIR}/foo`,
    blocked: true,
    label: '> 重定向写入受保护路径 -> 拦',
  },
  {
    id: '51',
    command: `echo hi >> ${DEV_DIR}/foo`,
    blocked: true,
    label: '>> 追加重定向受保护路径 -> 拦',
  },
  {
    id: '52',
    command: 'echo hi > /tmp/foo',
    blocked: false,
    label: '重定向到非保护路径 -> 放行',
  },
  { id: '53', command: 'echo hi 2>&1', blocked: false, label: 'fd 复制 2>&1 不算文件写入 -> 放行' },
  {
    id: '54',
    command: `dd if=/tmp/x of=${DEV_DIR}/foo`,
    blocked: true,
    label: 'dd of= 指向受保护路径 -> 拦',
  },
  {
    id: '55',
    command: `dd if=${DEV_DIR}/x of=/tmp/foo`,
    blocked: false,
    label: 'dd if= 是读取语义 -> 放行',
  },
  {
    id: '56',
    command: `truncate -s 0 ${DEV_DIR}/foo`,
    blocked: true,
    label: 'truncate 目标受保护 -> 拦',
  },
  {
    id: '57',
    command: `echo hi | tee ${DEV_DIR}/foo`,
    blocked: true,
    label: 'tee 目标受保护 -> 拦',
  },
  {
    id: '58',
    command: 'echo hi | tee /tmp/foo',
    blocked: false,
    label: 'tee 目标非保护 -> 放行',
  },
  {
    id: '59',
    command: `python -c "open('${DEV_DIR}/foo', 'w').write('x')"`,
    blocked: true,
    label: 'python 写模式 open 受保护路径 -> 拦',
  },
  { id: '60', command: `python -c "print('hi')"`, blocked: false, label: 'python 只打印 -> 放行' },
  {
    id: '61',
    command: `node -e "require('fs').writeFileSync('${DEV_DIR}/foo', 'x')"`,
    blocked: true,
    label: 'node writeFileSync 受保护路径 -> 拦',
  },
]

for (const item of writingVerbCases) {
  check(item.id, `${item.label}（${JSON.stringify(item.command)}）`, () => {
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
// 62-71 卡 5：&> 重定向修补 + 相对路径解析（cd 链跟踪）
// ===========================================================================

group('62-71 卡 5：&> 重定向修补 + 相对路径解析')

// 同样走 isProtectedPathModification + 真实 guard 双路验证。
// 64-71 依赖 DEV_DIR 真实存在（fs.existsSync 用它判断 cd 是否成功）。
const relativePathCases: Array<{ id: string; command: string; blocked: boolean; label: string }> = [
  {
    id: '62',
    command: `echo hi &> ${DEV_DIR}/foo`,
    blocked: true,
    label: '&> 重定向写入受保护路径 -> 拦',
  },
  {
    id: '63',
    command: `echo hi &>> ${DEV_DIR}/foo`,
    blocked: true,
    label: '&>> 追加重定向受保护路径 -> 拦',
  },
  {
    id: '64',
    command: `cd ${DEV_DIR} && rm -rf foo`,
    blocked: true,
    label: 'cd 到受保护区后 rm 相对路径 -> 拦',
  },
  {
    id: '65',
    command: `cd /tmp && cd ${DEV_DIR} && rm foo`,
    blocked: true,
    label: '两次 cd 链走到受保护区 -> 拦',
  },
  {
    id: '66',
    command: `cd ${DEV_DIR} && cd /tmp && rm foo`,
    blocked: false,
    label: 'cd 链离开受保护区 -> 放行',
  },
  {
    id: '67',
    command: `cd ${DEV_DIR} && rm foo bar`,
    blocked: true,
    label: '多个相对路径操作数 -> 拦',
  },
  {
    id: '68',
    command: 'cd /nonexistent && rm foo',
    blocked: false,
    label: 'cd 失败后跳过相对路径判断 -> 放行',
  },
  {
    id: '69',
    command: `cd ${DEV_DIR} && cp /tmp/x foo`,
    blocked: true,
    label: 'cp 相对目标落在受保护区 -> 拦',
  },
  {
    id: '70',
    command: `cd /tmp && rm -rf ${DEV_DIR}/foo`,
    blocked: true,
    label: 'cwd 非保护区但绝对路径指向受保护区 -> 拦',
  },
  {
    id: '71',
    command: `cd ${DEV_DIR} && echo hi > foo`,
    blocked: true,
    label: '重定向相对路径落在受保护区 -> 拦',
  },
]

for (const item of relativePathCases) {
  check(item.id, `${item.label}（${JSON.stringify(item.command)}）`, () => {
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
// 收尾
// ===========================================================================

// 释放 apply() 注册的 effect（包含配置热重载 watcher）
for (const dispose of effects) dispose()

rmSync(tmpDir, { recursive: true, force: true })

const total = passed + failures.length
console.log(`\n${failures.length === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed}/${total} 条`)

if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const failure of failures) console.log(`  - ${failure}`)
  console.log(`\n提示：第 5-19 条依赖 ${mod.CONFIG_PATH} 里的受保护路径/规则；配置被改过就先恢复默认（见 TESTING.md）。`)
  process.exitCode = 1
}
