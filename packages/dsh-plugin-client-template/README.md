# dsh-plugin-client-template

dsh-fortress 的客户端插件包（双半区）。

## 两个半区

| 半区 | 源码 | 产物 | 加载方 |
|------|------|------|--------|
| Node 半区（空插件，占位挂载） | `src/host.ts` | `dist/host.js`（ESM，包 main） | 宿主 loader 按 `cordis.yml` 条目 |
| 浏览器半区（Canvas 交互） | `src/index.ts` | `dist/index.cjs` → 被包装成 `window.__ModuleLoader__.load(...)` | DSH 客户端模块系统 |

- 导出形态：两个半区都只用具名导出 `name` / `apply`，无默认导出。
- 包名 `dsh-plugin-client-template` 被 `scripts/wrap-client-bundle.mjs`（bundle id）与 `scripts/auto-register.js`（loader id）写死引用，改名需同步这三处。

## 交互

页面存在 id 为 `dsh-plugin-client-template-root` 的容器时，其内会出现 120×60 的蓝色 canvas；点击输出 `[SessionTag] Canvas clicked: {"x":..,"y":..}`。

## 开发

```bash
pnpm build        # 根目录执行：tsdown 双产物 + wrap-client-bundle.mjs 包装
pnpm typecheck    # 根目录执行
cd packages/dsh-plugin-client-template && pnpm typecheck   # 仅本包
```
