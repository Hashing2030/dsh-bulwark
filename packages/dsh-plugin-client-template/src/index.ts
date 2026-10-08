/**
 * dsh-plugin-client-template —— 客户端插件「浏览器半区」入口
 *
 * 总体：本文件由 tsdown 以 CJS 编译为 dist/index.cjs，再由
 *       scripts/wrap-client-bundle.mjs 在构建后拼接成
 *       window.__ModuleLoader__.load({ id, factory(require) { ... } }) 形态，
 *       供 DSH 客户端模块系统在浏览器里注册。
 *
 * 定义：在页面提供的锚点容器内创建一块 Canvas 蓝色方块，点击时输出日志
 *       `[SessionTag] Canvas clicked: { x, y }`。
 *
 * 举例：页面存在 id="dsh-plugin-client-template-root" 的容器时，
 *       该容器内会出现 120x60 的蓝色 canvas，点击控制台打印坐标。
 *
 * 详细：只使用标准 DOM API（jsdom 下同样可测），不引入 @deepseek-ai/* 的运行时实现；
 *       对 ctx 里的槽位能力只做类型引用，待按 docs/ 官方 API 文档核对后再接真实槽位。
 */

// 仅类型导入：编译期擦除
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 插件名，与 wrap-client-bundle.mjs 的 PACKAGE_NAME 一致 */
export const name = 'dsh-plugin-client-template'

/** 页面锚点容器 id：客户端只操作自己命中的这个节点区域 */
const ROOT_ID = 'dsh-plugin-client-template-root'

/** 日志前缀，便于与其它插件区分 */
const LOG_PREFIX = '[SessionTag]'

/**
 * 插件主体：在锚点容器里挂一块可点击的 canvas。
 *
 * @param _ctx 客户端上下文（槽位 API 待官方文档核对后接入，本版未使用）
 */
export function apply(_ctx: ClientContext): void {
  // 非浏览器环境（如 Node 侧 import）直接跳过
  if (typeof document === 'undefined') return

  const root = document.getElementById(ROOT_ID)
  if (root === null) return

  const canvas = document.createElement('canvas')
  canvas.width = 120
  canvas.height = 60
  canvas.style.cursor = 'pointer'

  const painter = canvas.getContext('2d')
  if (painter !== null) {
    painter.fillStyle = '#2f6fed'
    painter.fillRect(0, 0, canvas.width, canvas.height)
  }

  canvas.addEventListener('click', (event: MouseEvent) => {
    console.log(`${LOG_PREFIX} Canvas clicked: ${JSON.stringify({ x: event.offsetX, y: event.offsetY })}`)
  })

  root.appendChild(canvas)
}
