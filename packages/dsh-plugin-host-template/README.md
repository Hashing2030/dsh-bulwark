# dsh-plugin-host-template

dsh-bulwark 的宿主端（Node.js）插件包。

## 入口

- 源码：`src/index.ts`
- 产物：`dist/index.js`（ESM，由根目录 `pnpm build` 生成）
- 导出形态：具名导出 `name` / `inject` / `apply`（无默认导出）

## HTTP 接口

| 方法 | 路径 | 返回 |
|------|------|------|
| GET | `/dsh-plugin-host-template-test` | `{ "serverTime": <epoch_ms> }` |

## 开发

```bash
pnpm build        # 根目录执行，构建宿主 + 客户端双产物
pnpm typecheck    # 根目录执行
cd packages/dsh-plugin-host-template && pnpm typecheck   # 仅本包
```
