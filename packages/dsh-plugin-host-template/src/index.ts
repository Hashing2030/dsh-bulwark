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
 *
 * 详细：@deepseek-ai/* 只允许 `import type`（编译期擦除），运行时不引入宿主实现，
 *       宿主能力（tools / webServer / systemPrompt 等）统一由 DSH 在运行时注入。
 */

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

  // 工具守卫（卡 3 记录 + 卡 4 删除识别）：tools.guard() 注册的是同步守卫，
  // 每次工具调用前都会收到 exec（Readonly<ToolExecution>）。卡 4 起对 bash 调用
  // 做删除语义识别，命中受保护工具的删除命令时返回字符串阻止执行（宿主把返回的
  // 字符串当作 block 原因）；未命中返回 undefined 放行。
  // 守卫体内刻意不抛错：即使 exec 结构不符合预期（字段缺失、甚至不是对象），
  // 也要走到 console.log 并原样放行，绝不能让一次异常打断工具调用链路。
  // guard() 返回的是撤销该守卫的 disposer，同样交给 ctx.effect() 托管，
  // 插件卸载 / 重载时自动摘除，不会留下悬空守卫。
  ctx.effect(
    () =>
      ctx.tools.guard((exec) => {
        console.log('[dsh-fortress:guard]', exec?.name, exec?.arguments)

        // 卡 4：只识别 bash 调用。可选链保证 exec / exec.arguments 缺失或不是
        // 对象时 command 只是 undefined，判断逻辑照常走完，不会抛错。
        if (exec?.name === 'bash') {
          const command = exec?.arguments?.command
          // 检查前先打印原文，方便调试匹配为什么不生效。
          console.log('[dsh-fortress:guard] bash command:', command)

          if (typeof command === 'string' && isProtectedRemoval(command)) {
            return 'blocked: protected tool removal'
          }
        }

        return undefined
      }),
    'dsh-fortress:tools guard',
  )

  return undefined
}
