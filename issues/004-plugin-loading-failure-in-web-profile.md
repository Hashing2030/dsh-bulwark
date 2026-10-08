---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] dsh-session-base-host / dsh-session-base-client 在 web profile 中未正确加载'
labels: ['bug']
assignees: ''
---

## 描述缺陷

在 web profile（直接运行 `dsh web`，不使用 `--patch`）下，`dsh-session-base-host` 与 `dsh-session-base-client` 两个插件均未正确加载：

- **宿主端插件** `dsh-session-base-host`：条目虽被挂载，但路由注册方式不符合 `dsh-host-webserver` 的 API，访问 `/dsh-plugin-host-template-test` 返回 404，路由形同虚设；
- **客户端插件** `dsh-session-base-client`：完全未进入浏览器启动清单（`window.__DSH_BOOT__` 无该条目），`/plugins/dsh-session-base-client/client.js` 返回 404，浏览器端 Canvas 标签始终不渲染。

## 复现步骤

1. 将插件安装到 web profile：
   ```bash
   dsh plugin --profile web add <项目根目录>/packages/dsh-plugin-host-template
   dsh plugin --profile web add <项目根目录>/packages/dsh-plugin-client-template
   ```
2. 执行 `dsh web` 启动（Web UI 默认端口）
3. 访问 `http://127.0.0.1:****/dsh-plugin-host-template-test` → 返回 **404**
4. 打开页面源码查看 `window.__DSH_BOOT__` 图 → 无 `dsh-session-base-client` 条目；页面无 Canvas 标签

## 预期行为

- `GET /dsh-plugin-host-template-test` 返回 `{"serverTime": <时间戳>}`；
- 客户端插件进入 `__DSH_BOOT__` 图，浏览器加载 `/plugins/dsh-session-base-client/client.js` 后在会话区域渲染 100×60 的蓝色 Canvas 标签（含点击事件与日志输出）。

## 实际行为

1. `/dsh-plugin-host-template-test` 返回 404：
   - `webServer.register` 被以 `(path, handler)` 调用，而运行时 API 接收路由对象 `{ kind, path, handler }`，字符串入参存入路由表后永远无法匹配；
   - 即使匹配成功，handler 收到的 `res` 是 node:http 原生 `ServerResponse`，没有 `res.json()` 方法，仍会抛错。
2. 客户端插件缺失：
   - profile 组合树中没有 `dsh-session-base-client` 条目（该包只作为普通依赖存在，`dsh plugin` 的 reconcile 仅把声明了 `dsh.bundle` 的包加入 bundles，客户端插件不会被挂载为 loader 条目，`dsh-client-modules` 按 loader 条目扫描时根本看不到它）；
   - 包清单 `dsh.client` 声明为字符串 `"./dist/index.js"`，而协议要求对象 `{ platform: "web" }`；
   - 包未提供 `exports["./client"]` 与 `exports["./package.json"]`，扫描器无法解析 bundle 路径；
   - 构建产物是裸 CJS（`exports.apply = ...`），未以 `window.__ModuleLoader__.load({ id, factory })` 自注册，即使进入图也无法在浏览器挂载；
   - `main` 指向不存在的 `dist/index.js`（实际产物为 `dist/index.cjs`）。

## 环境信息

- dsh 版本：0.1.1-rc.2（`dsh --version`）
- 插件版本：dsh-session-base-host 0.1.0 / dsh-session-base-client 0.1.0
- 操作系统：Windows 11
- Node.js 版本：v24.13.1
- 浏览器（Web UI 相关）：Chrome / Edge

## 日志 / 报错

宿主端路由探测：
```
GET http://127.0.0.1:****/dsh-plugin-host-template-test -> 404
```

客户端插件扫描相关错误（`dsh-client-modules`，修复前逐条命中）：
```
client-modules: dsh-session-base-client has a non-object dsh.client declaration
client-modules: dsh-session-base-client declares dsh.client but exports no "./client" bundle
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './package.json' is not defined by "exports"
    in <用户主目录>\.dsh\profiles\web\node_modules\dsh-session-base-client\package.json
```

页面启动清单证据（修复前）：
```
window["__DSH_BOOT__"] = {"rev":"...","entries":[...]}  // 42 个条目，无 dsh-session-base-client
GET /plugins/dsh-session-base-client/client.js -> 404
```

## 根因分析

1. **宿主端 API 误用**：`webServer.register` 的正确签名是 `register({ kind: 'exact' | 'prefix', path, handler })`，handler 收到原生 `req`/`res`；插件代码按 Express 风格编写，路由永远匹配不上，且 `res.json` 不存在。
2. **客户端插件协议不满足**：DSH 客户端插件是"双半区"包——loader 条目在宿主侧加载 Node 半区（空插件，保证 fiber 存活），浏览器逻辑经 `dsh.client`（对象形式）与 `exports["./client"]` 声明、以 `window.__ModuleLoader__.load({ id, factory })` 自注册的 bundle 交付；原包三处均不满足。
3. **未挂载**：客户端插件需要作为 loader 条目插入 profile 补丁（如 `<用户主目录>\.dsh\profiles\web\cordis.patch.yml`），仅安装为依赖不会进入 loader 扫描。
4. **类型桩固化错误 API**：仓库 `types/deepseek-ai.d.ts` 将 `webServer.register` 声明为旧签名 `(path, handler)`，掩盖了运行时契约差异。

## 解决方案

1. **宿主端**（`packages/dsh-plugin-host-template/src/index.ts`）：改为路由对象注册，并用 `writeHead` + `end` 输出 JSON：
   ```ts
   ctx.webServer.register({
     kind: 'exact',
     path: '/dsh-plugin-host-template-test',
     handler: (_req, res) => {
       res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
       res.end(JSON.stringify({ serverTime: Date.now() }))
     },
   })
   ```
2. **客户端 Node 半区**（`packages/dsh-plugin-client-template/src/host.ts`）：新增空 Cordis 插件，作为 loader 条目宿主侧挂载面。
3. **客户端清单**（`packages/dsh-plugin-client-template/package.json`）：
   ```json
   {
     "main": "./dist/host.js",
     "exports": {
       ".": "./dist/host.js",
       "./client": "./dist/index.cjs",
       "./package.json": "./package.json"
     },
     "dsh": { "client": { "platform": "web" } }
   }
   ```
4. **构建产物**（`tsdown.config.ts` + `scripts/wrap-client-bundle.mjs`）：浏览器半区构建为 CJS 主体，构建后包装为 `window.__ModuleLoader__.load({ id: "dsh-session-base-client", factory: (require) => { ... return module.exports } })`，与官方客户端 bundle 格式一致。
5. **挂载条目**（`<用户主目录>\.dsh\profiles\web\cordis.patch.yml`）：
   ```yaml
   - insert:
       - id: dsh-session-base-client
         name: dsh-session-base-client
   ```
6. **开发补丁**（`cordis.yml`）：客户端插件必须按包名挂载，不能用 `file://` 源码路径（`dsh-client-modules` 按包名解析 `package.json`）。
7. **类型桩**（`types/deepseek-ai.d.ts`）：`webServer.register` 修正为路由对象签名。

## 验证结果

- 单元测试：18/18 通过（host 5 + client 13）；`pnpm typecheck` 通过；
- 组合检查：`dsh --profile web --dump-config` 确认两个条目进入 profile 组合树；
- 端到端（独立端口真实实例）：
  - `GET /dsh-plugin-host-template-test` → **200** `{"serverTime": ...}`（修复前 404）；
  - `__DSH_BOOT__` 图包含 `dsh-session-base-client` 条目（43 个条目）；
  - `GET /plugins/dsh-session-base-client/client.js` → **200** `text/javascript`，内容为正确的 `window.__ModuleLoader__.load({ id: "dsh-session-base-client", ... })`；
  - jsdom 模拟浏览器挂载：注册成功 → `apply` 执行 → 创建 100×60 Canvas、点击事件、cleanup 钩子全部生效。

## 其他补充

- 该缺陷与 `001-client-plugin-loading-error.md`、`003-client-package-not-found.md` 同属"客户端插件加载"链路，但根因不同（本缺陷为协议格式与挂载缺失，非 `slots` 服务或包安装缺失）；`001` 中建议的 `"dsh": { "client": "./dist/index.js" }` 字符串形式经实测**不是**合法声明，应以本报告第 3 条的对象形式为准。
- 修复已落盘并重新构建；**当前运行的 Web UI 仍加载旧代码，需重启 `dsh web`（或开发模式 `pnpm run dev`）后生效**。
- 遗留：`dsh-plugin-create-template`、`organize-workspace-sessions` 两个包在 web profile 中同样未挂载（未在本报告范围内）。
