/**
 * dsh-plugin-host-template —— 宿主端插件入口
 *
 * 总体：本文件是宿主半区（Node.js 侧）的唯一入口，被 tsdown 编译为
 *       packages/dsh-plugin-host-template/dist/index.js，由根目录 cordis.yml
 *       的 loader 条目按包名 `dsh-plugin-host-template` 挂载。
 *
 * 定义：导出形态遵循项目约定——**只用具名导出**（name / inject / apply），
 *       不使用默认导出对象，两种形态不混写。
 *
 * 举例：web profile 下 DSH 启动后请求
 *       GET /dsh-plugin-host-template-test  →  { "serverTime": 1730000000000 }
 *       （headless profile 没有 webServer 服务，这条路由不注册）
 *       每次工具调用在宿主 stdout 上多打一行 [dsh-fortress:guard] 记录。
 *       卡 5 起 guard 还会拦下对受保护路径的写 / 改 / 删，只读操作一律放行。
 *       卡 6 起守则文本 / 受保护路径 / 删除规则都从 JSON 配置读，见 CONFIG.md。
 *
 * 详细：@deepseek-ai/* 只允许 `import type`（编译期擦除），运行时不引入宿主实现，
 *       宿主能力（tools / webServer / systemPrompt 等）统一由 DSH 在运行时注入。
 */

import { readFileSync, realpathSync, statSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { resolve } from 'node:path'

// 卡 3：shell 词法切分（纯函数、零依赖），用来替代脆弱的字符串 includes / 手写 split
import { splitCommand } from './shell-tokenizer.ts'

// 类型桩来源：根 tsconfig.json 的 paths "@deepseek-ai/*" -> "./types/deepseek-ai.d.ts"
import type { Context } from '@deepseek-ai/cordis'

/** 插件名，必须与根目录 cordis.yml 的 loader 条目 name 一致 */
export const name = 'dsh-plugin-host-template'

/**
 * 依赖的宿主服务：
 * - systemPrompt / tools 是硬依赖，直接写进 inject，DSH 会等服务就绪后再 apply；
 * - webServer 是可选能力——headless profile 里没有这个服务，若写进 inject，插件会
 *   一直 pending（waiting for service: webServer），所以改到 apply() 里判空。
 */
export const inject = ['systemPrompt', 'tools']

/** 宿主侧 HTTP 路由，与 README「HTTP 接口」章节保持一致 */
const ROUTE_PATH = '/dsh-plugin-host-template-test'

/** 守则段名字：全局唯一，注册与顺序查询都用它 */
const RULES_SECTION = 'dsh-fortress:rules'

/** 配置文件路径（卡 6）：它自己就在受保护路径内，AI 改不了，形成递归保护。 */
export const CONFIG_PATH = '/Users/liuzhaoyang/dsh-fortress-dev/config.json'

/**
 * 配置结构（卡 6，对应 CONFIG_PATH 指向的 config.json）：
 *
 *   {
 *     "rulesText": "守则文本字符串",
 *     "protectedPaths": ["/path1", "/path2"],
 *     "protectedRemovalPatterns": [
 *       { "keywords": ["dsh plugin", "remove", "dsh-fortress"] }
 *     ]
 *   }
 *
 * 字段说明见项目根目录 CONFIG.md。
 */
export interface FortressConfig {
  /** 注入 systemPrompt 的守则文本 */
  rulesText: string
  /** 只读保护路径：写 / 改 / 删拦，读取放行 */
  protectedPaths: string[]
  /** 删除语义规则：一条规则的 keywords 全部出现在命令里即拦 */
  protectedRemovalPatterns: Array<{ keywords: string[] }>
}

/**
 * 内置默认配置：内容就是卡 5 之前的硬编码值。
 *
 * 没有 config.json、文件读不动、JSON 语法错、字段缺失或类型不对时都用它，
 * 所以「没有配置文件」的行为与卡 5 完全一致。
 */
export const DEFAULT_CONFIG: FortressConfig = {
  rulesText: '[dsh-fortress 守则] 部分工具和路径受保护，不要尝试绕过。',
  protectedPaths: ['/Users/liuzhaoyang/dsh-fortress-dev'],
  protectedRemovalPatterns: [
    { keywords: ['dsh plugin', 'remove', 'dsh-fortress'] },
    { keywords: ['dsh plugin', 'remove', 'dsh-plugin-host-template'] },
    { keywords: ['dsh plugin', 'remove', 'dsh-plugin-client-template'] },
    { keywords: ['pnpm', 'remove', 'dsh-fortress'] },
    { keywords: ['npm', 'uninstall', 'dsh-fortress'] },
  ],
}

/**
 * 非空字符串数组判断（配置校验用）。
 *
 * 空数组一律算无效：protectedPaths / protectedRemovalPatterns 写成空数组
 * 等于关掉保护，更像误操作，所以退回默认值。
 *
 * @param raw 来自 JSON 的未知值
 * @returns 是合规的非空字符串数组返回 true
 */
function isNonEmptyStringArray(raw: unknown): raw is string[] {
  return (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((item) => typeof item === 'string' && item.length > 0)
  )
}

/**
 * 删除规则数组校验：每项必须是 { keywords: 非空字符串数组 }。
 *
 * @param raw 来自 JSON 的未知值
 * @returns 合规时返回规则数组，否则 undefined（交给默认值）
 */
function parseRemovalPatterns(raw: unknown): Array<{ keywords: string[] }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined

  const patterns: Array<{ keywords: string[] }> = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return undefined
    const keywords = (item as { keywords?: unknown }).keywords
    if (!isNonEmptyStringArray(keywords)) return undefined
    patterns.push({ keywords: [...keywords] })
  }
  return patterns
}

/**
 * 读配置文件（卡 6，模块加载阶段执行一次，不放在 apply() 里）。
 *
 * 全程不抛错：文件不存在、读不动、JSON 语法错误、字段缺失或类型不对，
 * 都退回 DEFAULT_CONFIG——插件必须能加载，配置出问题最多让某项回到默认值。
 * 字段逐个校验、逐项回退：一个字段写坏了不影响其它字段。
 *
 * @returns 本次加载生效的配置
 */
/** 读取配置；configPath 仅供测试注入，默认读 CONFIG_PATH */
export function loadConfig(configPath: string = CONFIG_PATH): FortressConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return DEFAULT_CONFIG
  }

  if (parsed === null || typeof parsed !== 'object') return DEFAULT_CONFIG
  const raw = parsed as Record<string, unknown>

  const rulesText =
    typeof raw.rulesText === 'string' && raw.rulesText.length > 0
      ? raw.rulesText
      : DEFAULT_CONFIG.rulesText

  return {
    rulesText,
    protectedPaths: isNonEmptyStringArray(raw.protectedPaths)
      ? [...raw.protectedPaths]
      : DEFAULT_CONFIG.protectedPaths,
    protectedRemovalPatterns:
      parseRemovalPatterns(raw.protectedRemovalPatterns) ?? DEFAULT_CONFIG.protectedRemovalPatterns,
  }
}

/** 本次加载生效的配置（模块加载时算一次，改完配置要重启 DSH 才生效） */
let CONFIG: FortressConfig = loadConfig()

/**
 * 从磁盘重新读取配置文件并整体替换 CONFIG（卡 1 配置热重载）。
 *
 * - 读取失败 / 非法 JSON / 顶层不是对象：保留旧 CONFIG，返回 false（不抛错）
 * - 成功：CONFIG 换成新配置，返回 true
 *
 * apply() 里的 fs.watch 与 e2e 测试都走这条路径。
 *
 * @param configPath 配置文件路径，默认 CONFIG_PATH
 * @returns 是否成功重载
 */
export function reloadConfig(configPath: string = CONFIG_PATH): boolean {
  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') {
      console.log('[dsh-fortress:config] reload failed, keeping old config: not a JSON object')
      return false
    }
    CONFIG = loadConfig(configPath)
    return true
  } catch (error) {
    console.log('[dsh-fortress:config] reload failed, keeping old config', error)
    return false
  }
}

/** 只读返回当前 CONFIG 的浅拷贝（e2e 测试用）。 */
export function __getConfigForTest(): FortressConfig {
  return { ...CONFIG }
}

/** 用局部补丁替换当前 CONFIG（e2e 测试用，模拟配置变更）。 */
export function __setConfigForTest(patch: Partial<FortressConfig>): void {
  CONFIG = { ...CONFIG, ...patch }
}

/**
 * 守则文本（卡 6 起来自配置的 rulesText，缺省时用 DEFAULT_CONFIG.rulesText）。
 *
 * 段上设置 interpolate: false，正文里的 `{{…}}` 等字面花括号不会被当成
 * 提示词变量插值。
 */
export function getRulesText(): string {
  return CONFIG.rulesText
}

/**
 * 顺序锚点：systemPrompt 中心顺序表里最靠后的一段（部署人格后缀）。
 * 用途见 resolveRulesOrder()。
 */
const ORDER_ANCHOR = 'DEPLOYMENT_PERSONA_SUFFIX'

/**
 * 解析守则段的 order。
 *
 * 约定：不硬编码数字，位置一律向 systemPrompt 的中心顺序表要。
 * 但 getSectionOrder(name) 只认中心表里登记过的名字，未登记的名字返回
 * undefined，而 section() 对非有限 order 会抛 TypeError，直接透传会让插件
 * 加载失败。因此分两级：
 *
 *   1. 先要 'dsh-fortress:rules' 自己的位置——名字一旦被中心表登记即自动生效；
 *   2. 当前它属于外部名字、中心表里没有，于是退回锚点 DEPLOYMENT_PERSONA_SUFFIX
 *      （SECTION_ORDERS 的最后一段，由 DSH 自己注册），守则排在宿主说明之后。
 *
 * @param ctx Cordis 上下文（由 DSH 在运行时注入，本地仅用类型）
 * @returns 有限数字，可直接交给 systemPrompt.section()
 */
function resolveRulesOrder(ctx: Context): number {
  const own = ctx.systemPrompt.getSectionOrder(RULES_SECTION)
  if (own !== undefined) return own

  const anchor = ctx.systemPrompt.getSectionOrder(ORDER_ANCHOR)
  if (anchor === undefined) {
    throw new Error(`[dsh-fortress] systemPrompt 中心顺序表里缺少锚点 ${ORDER_ANCHOR}`)
  }
  return anchor
}

/** 卡 3 改进 2：命令开头的包装器，跳过它们取后面的真正动词 */
const WRAPPER_COMMANDS = ['sudo', 'command', 'nohup', 'env']

/** 卡 3 改进 3：支持 -c 内层脚本的 shell 名字 */
const SHELL_COMMANDS = ['bash', 'sh', 'zsh', 'dash']

/** 卡 3 改进 3：bash -c 递归的最大层数，超过就按普通字符串处理 */
const MAX_SHELL_NESTING = 3

/** 形如 VAR=value 的环境变量前缀（env 的参数，也是常见的行内赋值） */
function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/**
 * 卡 3 改进 2：跳过命令开头的包装器，返回剩下的 token。
 *
 * 规则：sudo / command / nohup / env 直接跳过；env 后面（以及命令开头）的
 * VAR=value 行内赋值也跳过；第一个「既不是包装器也不是赋值」的 token 才是动词。
 * 全是包装器 / 赋值时返回空数组，调用方按未命中处理。
 *
 * @param tokens 一段命令的 token 列表
 * @returns 去掉开头包装器后的 token 列表
 */
function unwrapWrappers(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length) {
    if (WRAPPER_COMMANDS.includes(verbName(tokens[index])) || isEnvAssignment(tokens[index])) {
      index += 1
      continue
    }
    break
  }
  return tokens.slice(index)
}

/**
 * 卡 3：把一条命令行展开成「待判定的 token 段」列表。
 *
 * 三件事叠在一起：
 *   1. 用 splitCommand() 做引号感知的词法切分（改进 1）——引号内的 rm 不再
 *      是独立 token，引号内的 && ; | 也不再切段；
 *   2. unwrapWrappers() 解开 sudo / env FOO=bar / command / nohup（改进 2）；
 *   3. 遇到 bash -c / sh -c 时取 -c 后那个 token 递归解析，最多 3 层（改进 3），
 *      超过层数就当普通字符串（shell 动词本身不是写 / 删动词，等于放行）。
 *
 * 硬约束：tokenizer 抛错时捕获并返回空数组，调用方一律走放行，绝不向上抛。
 *
 * @param command bash 工具的原始命令字符串
 * @param depth 当前递归层数，顶层传 0
 * @returns 展开后的 token 段列表（可能为空）
 */
function collectSegments(command: string, depth: number): string[][] {
  let rawSegments: string[][]
  try {
    rawSegments = splitCommand(command)
  } catch {
    return []
  }

  const result: string[][] = []
  for (const raw of rawSegments) {
    const tokens = unwrapWrappers(raw)
    if (tokens.length === 0) continue

    const verb = verbName(tokens[0])
    if (SHELL_COMMANDS.includes(verb)) {
      if (depth >= MAX_SHELL_NESTING) continue
      const flagIndex = tokens.indexOf('-c')
      if (flagIndex === -1 || flagIndex + 1 >= tokens.length) continue
      for (const inner of collectSegments(tokens[flagIndex + 1], depth + 1)) {
        result.push(inner)
      }
      continue
    }

    result.push(tokens)
  }
  return result
}

/**
 * 卡 3：单个 token 是否匹配关键词的一个片段。
 *
 * 匹配刻意收紧到「整个 token 相等」或「以 / 分隔的末段相等」：
 *   - 'dsh-fortress' 命中 token 'dsh-fortress' 与 '@scope/dsh-fortress'；
 *   - 关键词若只出现在引号包住的整段里（token 内含空格，比如
 *     `"pnpm remove dsh-fortress"`），不算命中——引号内是数据不是命令。
 *
 * @param token splitCommand 切出来的单个 token
 * @param part 关键词按空白拆出来的片段
 * @returns 命中返回 true
 */
function tokenMatchesKeywordPart(token: string, part: string): boolean {
  if (token === part) return true
  if (token.includes(' ')) return false
  return token.endsWith('/' + part)
}

/**
 * 关键词（可以含空格，如 'dsh plugin'）是否作为连续 token 子序列出现。
 *
 * @param tokens 命令展开后的全部 token
 * @param keyword 配置里的一条关键词
 * @returns 命中返回 true
 */
function tokensHaveKeyword(tokens: string[], keyword: string): boolean {
  const parts = keyword.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) return false
  for (let start = 0; start + parts.length <= tokens.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < parts.length; offset += 1) {
      if (!tokenMatchesKeywordPart(tokens[start + offset], parts[offset])) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/**
 * 删除语义识别（卡 4 起，卡 3 接入 tokenizer）：判断一条 bash 命令是否在删除受保护工具。
 *
 * 卡 3 起不再用 `command.includes(keyword)`，而是先用 collectSegments() 做引号感知的
 * 词法切分 / 包装器解包 / bash -c 递归，再在 token 层面匹配。规则（卡 6 起）来自配置的
 * protectedRemovalPatterns：一条规则是一组 { keywords: [...] }，命令「同时命中该规则的
 * 全部关键词」即命中；命中任一规则就返回 true。默认规则（DEFAULT_CONFIG）：
 *   1. 'dsh plugin' + 'remove' + 'dsh-fortress'
 *   2. 'dsh plugin' + 'remove' + 'dsh-plugin-host-template'
 *   3. 'dsh plugin' + 'remove' + 'dsh-plugin-client-template'
 *   4. 'pnpm' + 'remove' + 'dsh-fortress'
 *   5. 'npm' + 'uninstall' + 'dsh-fortress'
 *
 * @param command bash 工具的原始命令字符串
 * @returns 命中受保护删除返回 true
 */
// 导出供 tests/e2e.test.ts 直接驱动；运行时行为不变
export function isProtectedRemoval(command: string): boolean {
  // 跨段压平后匹配：关键词可以跨 && || ; | 出现，与旧的整串 includes 语义一致。
  const tokens = collectSegments(command, 0).flat()
  return CONFIG.protectedRemovalPatterns.some((pattern) =>
    pattern.keywords.every((keyword) => tokensHaveKeyword(tokens, keyword)),
  )
}

/**
 * 受保护路径（卡 6 起来自配置的 protectedPaths，缺省用 DEFAULT_CONFIG）。
 *
 * 保护的语义是「只读」：写、改、删、移动都拦，读取一律放行，所以
 * read / grep / glob 这类工具完全不出现在下面的判断里。
 */
export function getProtectedPaths(): string[] {
  return CONFIG.protectedPaths
}

/**
 * 路径归一化：先 realpathSync（解析符号链接、把 /var 收敛成 /private/var），
 * 失败就退回 path.resolve（路径不存在、权限不足时 realpathSync 会抛错）。
 *
 * 统一转小写，因为 APFS 默认大小写不敏感，/Users 和 /users 是同一个目录。
 * 整个函数不抛错：任何异常都退化成 resolve 的结果，最坏情况只是匹配不上。
 *
 * @param raw 原始路径字符串
 * @returns 小写的绝对路径
 */
function normalizePath(raw: string): string {
  try {
    return realpathSync(raw).toLowerCase()
  } catch {
    return resolve(raw).toLowerCase()
  }
}

/**
 * PROTECTED_PATHS 归一化后的前缀表，模块加载时算一次。
 *
 * 预先 realpath 是为了绕开 macOS 的 /var → /private/var 这类等价拼法：
 * 配置里写的和命令里写的可能指向同一个目录，却不是同一个字符串。
 * normalizePath() 自己不抛错，所以放在模块顶层是安全的。
 */
let protectedPrefixCache: { key: string; prefixes: string[] } | undefined

/**
 * 当前受保护路径前缀，每次调用重新归一化（带缓存）。
 *
 * normalizePath() 内含 realpathSync 系统调用；用 CONFIG.protectedPaths 的
 * JSON 字符串做 key，配置没变就复用上次结果。
 *
 * @returns 归一化后的路径前缀列表
 */
export function getProtectedPathPrefixes(): string[] {
  const key = JSON.stringify(CONFIG.protectedPaths)
  if (protectedPrefixCache !== undefined && protectedPrefixCache.key === key) {
    return protectedPrefixCache.prefixes
  }
  const prefixes = CONFIG.protectedPaths.map((path) => normalizePath(path))
  protectedPrefixCache = { key, prefixes }
  return prefixes
}

/**
 * 判断一个已归一化的路径是否落在受保护前缀之内。
 *
 * 用「相等 或 前缀 + 斜杠」，而不是裸 startsWith：否则
 * /Users/.../dsh-fortress-dev-2 这种兄弟目录会被误判成受保护。
 *
 * @param normalized normalizePath() 的输出
 * @returns 命中受保护路径返回 true
 */
function matchesProtectedPrefix(
  normalized: string,
  pathsOverride?: string[],
): boolean {
  const prefixes = pathsOverride
    ? pathsOverride.map((path) => normalizePath(path))
    : getProtectedPathPrefixes()
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
  )
}

/**
 * 原始路径字符串是否受保护（写 / 删判断的统一入口）。
 *
 * @param raw 来自工具参数的未知值，非字符串一律视为不命中
 * @param pathsOverride 可选的受保护路径清单（测试注入用）；省略时用 CONFIG.protectedPaths
 * @returns 命中受保护路径返回 true
 */
// 导出供 tests/e2e.test.ts 直接驱动；运行时行为不变
export function isProtectedPath(raw: unknown, pathsOverride?: string[]): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false
  return matchesProtectedPrefix(normalizePath(raw), pathsOverride)
}

/** bash 里与写 / 删 / 移动有关的动词，卡 5 只认这三个 */
const MUTATING_VERBS = ['rm', 'mv', 'cp']

/**
 * 取一个 token 的动词名：'/bin/rm' → 'rm'，带引号的 rm 也一样。
 *
 * @param token 命令切分出来的单个 token
 * @returns 去掉引号与目录前缀后的名字
 */
function verbName(token: string): string {
  const unquoted = token.replace(/^['"]|['"]$/g, '')
  const parts = unquoted.split('/')
  return parts[parts.length - 1]
}

/**
 * 取一个 token 表示的操作数路径：顺带处理 --flag=value 这种写法。
 *
 * @param token 命令切分出来的单个 token
 * @returns 去引号、去 --flag= 前缀后的字符串
 */
function operandPath(token: string): string {
  const unquoted = token.replace(/^['"]|['"]$/g, '')
  const eq = unquoted.indexOf('=')
  return eq >= 0 ? unquoted.slice(eq + 1) : unquoted
}

/**
 * bash 命令级判断（卡 5 起，卡 3 接入 tokenizer）：命令里是否在对受保护路径做写 / 删 / 移动。
 *
 * 卡 3 起不再手写 split，改用 collectSegments()：
 *   1. 先按引号感知地切成段（引号内的 && ; | 不算分隔符），并解开
 *      sudo / command / nohup / env FOO=bar 包装器、递归展开 bash -c；
 *   2. 每个展开后的段里，第一个 token 是动词，不是 rm / mv / cp 的段直接跳过；
 *   3. cp：只有「目标是受保护路径」才拦——cp 受保护路径 → 别处 是读取语义，
 *      放行。目标取动词之后最后一个非选项操作数；
 *   4. rm / mv：该段里任一操作数落在受保护路径内就拦——rm 是删除，mv 无论
 *      朝哪个方向都会改动受保护那一侧。
 *
 * 引号内的 rm（如 `echo "rm /path"`）被 tokenizer 收成一个整体 token，不再被当成动词。
 * 只认绝对路径 token（以斜杠开头），相对路径的相对基准解析留给后面的卡。
 *
 * 守卫体内不抛错：tokenizer 抛错时 collectSegments() 返回空列表，直接放行。
 *
 * @param command bash 工具的原始命令字符串
 * @param pathsOverride 可选的受保护路径清单（测试注入用）；省略时用 CONFIG.protectedPaths
 * @returns 命中受保护路径的写 / 删返回 true
 */
// 导出供 tests/e2e.test.ts 直接驱动；运行时行为不变
export function isProtectedPathModification(
  command: string,
  pathsOverride?: string[],
): boolean {
  const segments = collectSegments(command, 0)

  for (const tokens of segments) {
    const verb = verbName(tokens[0])
    if (!MUTATING_VERBS.includes(verb)) continue

    const operands = tokens.slice(1)

    if (verb === 'cp') {
      // 目标 = 最后一个非选项操作数；只看它，源是受保护路径属于读取语义。
      for (let i = operands.length - 1; i >= 0; i -= 1) {
        const candidate = operandPath(operands[i])
        if (candidate.startsWith('-')) continue
        if (candidate.startsWith('/') && isProtectedPath(candidate, pathsOverride)) return true
        break
      }
      continue
    }

    for (const token of operands) {
      const candidate = operandPath(token)
      if (candidate.startsWith('/') && isProtectedPath(candidate, pathsOverride)) return true
    }
  }

  return false
}

/**
 * 插件主体：注册宿主侧 HTTP 接口 + 注入 dsh-fortress 守则段 + 挂工具守卫。
 *
 * @param ctx Cordis 上下文（由 DSH 在运行时注入，本地仅用类型）
 */
export function apply(ctx: Context): void {
  // webServer 是可选能力：web profile 有它，headless profile 没有。
  // 注意判空不能用 ctx.webServer：cordis 的 Context 是 Proxy，读取没有 inject 的
  // 服务会抛 `cannot get property "webServer" without inject`；ctx.get() 才是
  // 「不要求 inject」的安全读法，未提供该服务时返回 undefined。
  // 有就注册 HTTP 路由，没有就整段跳过，插件照常加载（不再 pending）。
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (_req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ serverTime: Date.now() }))
      },
    })
  }

  // 守则注入：注册一个 systemPrompt 段。section() 返回的是可撤销该段的
  // disposer，交给 ctx.effect() 托管，插件卸载 / 重载时自动撤销，不会在
  // 提示词里留下悬空段落。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: RULES_SECTION,
        order: resolveRulesOrder(ctx),
        // 卡 1：用 getter 而非快照值，systemPrompt 每次组装时重新读取 CONFIG
        get text() {
          return getRulesText()
        },
        interpolate: false,
      }),
    'dsh-fortress:rules section',
  )

  // 工具守卫（卡 3 记录 + 卡 4 删除识别 + 卡 5 路径只读保护）：tools.guard()
  // 注册的是同步守卫，每次工具调用前都会收到 exec（Readonly<ToolExecution>）。
  // 卡 4 起对 bash 调用做删除语义识别；卡 5 起再补两条：bash 里对受保护路径的
  // 写 / 删 / 移动，以及 write / edit / str_replace_editor 指向受保护路径的调用。
  // 命中时返回字符串阻止执行（宿主把返回的字符串当作 block 原因）；未命中返回
  // undefined 放行。read / grep / glob 等只读工具完全不参与判断。
  // 守卫体内刻意不抛错：即使 exec 结构不符合预期（字段缺失、甚至不是对象），
  // 也要走到 console.log 并原样放行，绝不能让一次异常打断工具调用链路。
  // guard() 返回的是撤销该守卫的 disposer，同样交给 ctx.effect() 托管，
  // 插件卸载 / 重载时自动摘除，不会留下悬空守卫。
  ctx.effect(
    () =>
      ctx.tools.guard((exec) => {
        console.log('[dsh-fortress:guard]', exec?.name, exec?.arguments)

        // 卡 4 / 卡 5：只识别 bash 调用。可选链保证 exec / exec.arguments 缺失或
        // 不是对象时 command 只是 undefined，判断逻辑照常走完，不会抛错。
        if (exec?.name === 'bash') {
          const command = exec?.arguments?.command
          // 检查前先打印原文，方便调试匹配为什么不生效。
          console.log('[dsh-fortress:guard] bash command:', command)

          if (typeof command === 'string') {
            // 卡 4：删除受保护工具（dsh plugin remove / pnpm remove 等）。
            if (isProtectedRemoval(command)) {
              return 'blocked: protected tool removal'
            }

            // 卡 5：对受保护路径的写 / 删 / 移动；cp 受保护路径 → 别处 属于读取，放行。
            if (isProtectedPathModification(command)) {
              return 'blocked: protected path modification'
            }
          }
        }

        // 卡 5：文件类工具的目标路径判断。只列写类工具，
        // read / grep / glob 这些只读工具刻意不进来。
        if (
          exec?.name === 'write' ||
          exec?.name === 'edit' ||
          exec?.name === 'str_replace_editor'
        ) {
          const args = exec?.arguments
          if (args !== null && typeof args === 'object') {
            // 两套参数名都试：本仓用 path，Claude 风格的工具用 file_path。
            const candidate = args.path ?? args.file_path
            if (isProtectedPath(candidate)) {
              return 'blocked: protected path modification'
            }
          }
        }

        return undefined
      }),
    'dsh-fortress:tools guard',
  )

  // 卡 1 配置热重载：config.json 改动后不重启 DSH 也能生效。
  // watcher 交给 ctx.effect() 托管，插件卸载 / 重载时自动关闭。
  // 启动失败（例如配置文件不存在）只打日志，降级为「重启后生效」，不抛错。
  ctx.effect(
    () => {
      let lastMtime = 0
      let watcher: FSWatcher | undefined
      try {
        watcher = watch(CONFIG_PATH, (eventType: string) => {
          if (eventType !== 'change') return
          try {
            const stat = statSync(CONFIG_PATH)
            const mtime = stat.mtimeMs
            // mtime 去抖：重复事件 / 事件风暴只重载一次
            if (mtime === lastMtime) return
            lastMtime = mtime
            if (reloadConfig()) {
              console.log('[dsh-fortress:config] reloaded')
            }
          } catch (error) {
            console.log('[dsh-fortress:config] reload failed, keeping old config', error)
          }
        })
        // 不把宿主进程钉在事件循环上；DSH 自身有其它 handle 维持生命周期
        watcher.unref()
      } catch (error) {
        console.log(
          '[dsh-fortress:config] watcher unavailable, config changes need a restart',
          error,
        )
      }
      return () => {
        if (watcher !== undefined) watcher.close()
      }
    },
    'dsh-fortress:config watcher',
  )

  return undefined
}
