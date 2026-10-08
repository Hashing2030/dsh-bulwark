/**
 * @deepseek-ai 包模拟类型定义
 *
 * 用于本地开发和测试，实际运行时由 DSH 宿主框架提供
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    // 可选：web profile 有 webServer 服务，headless profile 没有，插件里要判空。
    webServer?: {
      // 与 @deepseek-ai/dsh-host-webserver 运行时一致：register 接收路由对象
      // { kind, path, handler }，handler 收到 node:http 的 IncomingMessage / ServerResponse。
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: any, res: any) => void
      }): void
    }

    // 读服务但不要求 inject：未提供该服务时返回 undefined，不会抛错
    // （直接访问 ctx.webServer 在服务缺席时会抛 `cannot get property ... without inject`）。
    get<K extends string & keyof this>(name: K): undefined | this[K]

    // Cordis 副作用托管：回调立即执行，其返回的 disposer 在插件卸载时调用。
    // 与运行时一致：ctx.effect(callback, label?) -> disposer
    effect(callback: () => void | (() => void), label?: string): () => void

    // 系统提示词服务，对应 @deepseek-ai/dsh-system-prompt：
    // - section() 注册（或按名遮蔽）一个提示词段，返回可撤销它的 disposer；
    //   order 必须是有限数字，否则抛 TypeError；
    // - getSectionOrder(name) 查中心顺序表 SECTION_ORDERS，未登记的名字返回 undefined。
    systemPrompt: {
      section(section: {
        name: string
        order: number
        text: string
        interpolate?: boolean
        complete?: boolean
      }): () => void
      getSectionOrder(name: string): number | undefined
    }

    // 工具服务，对应 @deepseek-ai/dsh-tools（硬依赖，已写进 inject）：
    // - guard() 注册同步工具守卫，返回可撤销该守卫的 disposer；
    // - 守卫收到 exec（运行时是 Readonly<ToolExecution>），返回 undefined 放行，
    //   返回字符串或 { reason[, abortRunCode] } 表示拦截。
    // 这里用 any 描述 exec，只是为了让本地 tsc 能过，不追求与宿主类型精确一致。
    tools: {
      guard(
        guard: (
          exec: any,
        ) => string | { reason: string; abortRunCode?: boolean } | undefined,
      ): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  // 空模块声明
}

declare module '@deepseek-ai/dsh-system-prompt' {
  // 空模块声明
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export interface ClientContext {
    slots: any
  }
}
