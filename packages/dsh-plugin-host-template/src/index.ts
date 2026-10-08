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
 *
 * 详细：@deepseek-ai/* 只允许 `import type`（编译期擦除），运行时不引入宿主实现，
 *       宿主能力（tools / webServer / systemPrompt 等）统一由 DSH 在运行时注入。
 */

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

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

/**
 * 守则文本（卡 2 先写静态字符串，后续卡再做可配置）。
 *
 * 段上设置 interpolate: false，正文里的 `{{…}}` 等字面花括号不会被当成
 * 提示词变量插值。
 */
const RULES_TEXT = '[dsh-fortress 守则] 部分工具和路径受保护，不要尝试绕过。'

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

/**
 * 删除语义识别（卡 4 最小闭环）：判断一条 bash 命令是否在删除受保护工具。
 *
 * 这一版故意只做简单字符串匹配、不做完整 shell 解析（tokenizer 是后面的卡），
 * 所以像 `dsh plugin remove @scope/dsh-fortress` 这种变体认不出来，属于已知局限。
 * 关键词硬编码在这里是临时的，卡 6 改成从配置读。
 *
 * 命中规则逐条对应需求，命中任一即返回 true：
 *   1. 'dsh plugin' + 'remove' + 'dsh-fortress'
 *   2. 'dsh plugin' + 'remove' + 'dsh-plugin-host-template'
 *   3. 'dsh plugin' + 'remove' + 'dsh-plugin-client-template'
 *   4. 'pnpm' + 'remove' + 'dsh-fortress'
 *   5. 'npm' + 'uninstall' + 'dsh-fortress'
 *
 * @param command bash 工具的原始命令字符串
 * @returns 命中受保护删除返回 true
 */
function isProtectedRemoval(command: string): boolean {
  const has = (keyword: string): boolean => command.includes(keyword)

  const dshPluginRemove = has('dsh plugin') && has('remove')

  if (dshPluginRemove && has('dsh-fortress')) return true
  if (dshPluginRemove && has('dsh-plugin-host-template')) return true
  if (dshPluginRemove && has('dsh-plugin-client-template')) return true
  if (has('pnpm') && has('remove') && has('dsh-fortress')) return true
  if (has('npm') && has('uninstall') && has('dsh-fortress')) return true

  return false
}

/**
 * 受保护路径（卡 5 先硬编码，下张卡改成从配置读）。
 *
 * 保护的语义是「只读」：写、改、删、移动都拦，读取一律放行，所以
 * read / grep / glob 这类工具完全不出现在下面的判断里。
 */
const PROTECTED_PATHS = ['/Users/liuzhaoyang/dsh-fortress-dev']

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
const PROTECTED_PATH_PREFIXES = PROTECTED_PATHS.map((path) => normalizePath(path))

/**
 * 判断一个已归一化的路径是否落在受保护前缀之内。
 *
 * 用「相等 或 前缀 + 斜杠」，而不是裸 startsWith：否则
 * /Users/.../dsh-fortress-dev-2 这种兄弟目录会被误判成受保护。
 *
 * @param normalized normalizePath() 的输出
 * @returns 命中受保护路径返回 true
 */
function matchesProtectedPrefix(normalized: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
  )
}

/**
 * 原始路径字符串是否受保护（写 / 删判断的统一入口）。
 *
 * @param raw 来自工具参数的未知值，非字符串一律视为不命中
 * @returns 命中受保护路径返回 true
 */
function isProtectedPath(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false
  return matchesProtectedPrefix(normalizePath(raw))
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
 * bash 命令级判断（卡 5 简化版）：命令里是否在对受保护路径做写 / 删 / 移动。
 *
 * 依旧是字符串级判断、不做完整 shell 解析（tokenizer 是后面的卡），规则：
 *   1. 先按 && || ; | 换行 切段逐段看，没出现 rm / mv / cp 的段直接跳过；
 *   2. cp：只有「目标是受保护路径」才拦——cp 受保护路径 → 别处 是读取语义，
 *      放行。目标取动词之后最后一个非选项操作数；
 *   3. rm / mv：该段里任一操作数落在受保护路径内就拦——rm 是删除，mv 无论
 *      朝哪个方向都会改动受保护那一侧。
 *
 * 只认绝对路径 token（以斜杠开头），相对路径的相对基准解析留给后面的卡。
 *
 * @param command bash 工具的原始命令字符串
 * @returns 命中受保护路径的写 / 删返回 true
 */
function isProtectedPathModification(command: string): boolean {
  const segments = command.split(/&&|\|\||[;|\n]/)

  for (const segment of segments) {
    const tokens = segment.split(/\s+/).filter((token) => token.length > 0)
    const verbIndex = tokens.findIndex((token) => MUTATING_VERBS.includes(verbName(token)))
    if (verbIndex === -1) continue

    const operands = tokens.slice(verbIndex + 1)

    if (verbName(tokens[verbIndex]) === 'cp') {
      // 目标 = 最后一个非选项操作数；只看它，源是受保护路径属于读取语义。
      for (let i = operands.length - 1; i >= 0; i -= 1) {
        const candidate = operandPath(operands[i])
        if (candidate.startsWith('-')) continue
        if (candidate.startsWith('/') && isProtectedPath(candidate)) return true
        break
      }
      continue
    }

    for (const token of operands) {
      const candidate = operandPath(token)
      if (candidate.startsWith('/') && isProtectedPath(candidate)) return true
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
        text: RULES_TEXT,
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

  return undefined
}
