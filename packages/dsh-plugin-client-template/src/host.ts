/**
 * dsh-plugin-client-template —— 客户端插件「Node 半区」入口
 *
 * 总体：DSH 的客户端插件是双半区结构。本文件是 Node 半区（包 main 指向的
 *       dist/host.js），只负责让根目录 cordis.yml 里那条
 *       `name: dsh-plugin-client-template` 的 loader 条目能在宿主侧挂载成功。
 *
 * 定义：**空插件**——不注册任何宿主服务、不碰 DOM，真正的浏览器逻辑在
 *       src/index.ts（由 tsdown 编成 dist/index.cjs，再由
 *       scripts/wrap-client-bundle.mjs 包成 window.__ModuleLoader__.load(...)）。
 *
 * 举例：宿主加载 cordis.yml 时，本插件被 apply 一次，除返回外无副作用。
 *
 * 详细：导出形态与宿主半区一致，只用具名导出（name / apply），无默认导出。
 */

// 仅类型导入：编译期擦除，运行时不引入宿主实现
import type { Context } from '@deepseek-ai/cordis'

/** 插件名，必须与 cordis.yml 的 loader 条目、wrap-client-bundle.mjs 的 id 一致 */
export const name = 'dsh-plugin-client-template'

/**
 * Node 半区不做任何事：仅用于占位挂载。
 *
 * @param _ctx Cordis 上下文（本半区不使用）
 */
export function apply(_ctx: Context): void {
  // 有意留空：浏览器半区的逻辑在 src/index.ts
}
