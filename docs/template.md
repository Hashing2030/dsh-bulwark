# dsh-plugin-create-template 项目文档

> **文档性质**：本文档为当前项目**真实状态**的同步记录（区别于早期的设计愿景稿），随代码变更持续更新。文档中涉及本地路径处一律使用 `<项目根目录>` / `<用户主目录>` 占位符（安全脱敏规则）。

---

## 目录

- [一、项目概述](#一项目概述)
- [二、整体架构](#二整体架构)
- [三、目录结构](#三目录结构)
- [四、技术栈](#四技术栈)
- [五、宿主端插件（dsh-plugin-host-template）](#五宿主端插件dsh-plugin-host-template)
- [六、客户端插件（dsh-plugin-client-template）](#六客户端插件dsh-plugin-client-template)
- [七、构建与打包](#七构建与打包)
- [八、开发与调试](#八开发与调试)
- [九、测试](#九测试)
- [十、已解决问题与排查指南](#十已解决问题与排查指南)
- [十一、关键工程决策与踩坑记录](#十一关键工程决策与踩坑记录)
- [十二、后续规划](#十二后续规划)

---

## 一、项目概述

本项目是基于 **DeepSeek Harness（DSH）插件系统**构建的会话管理插件 **dsh-plugin-create-template**，目标是帮助用户快速识别哪些会话需要重点跟进。

当前阶段为 **MVP 验证期**：采用**双包拆分架构**打通"宿主端插件 + 客户端插件"的完整加载链路，验证 DSH 的插件协议、双半区浏览器插件机制、构建打包与自动注册流程，为后续会话标签能力打基础。

| 包 | 插件名 | 职责 |
|---|---|---|
| `packages/dsh-plugin-host-template` | `dsh-plugin-host-template` | 宿主端（Node 进程）：通过 `ctx.webServer` 注册 HTTP 接口 |
| `packages/dsh-plugin-client-template` | `dsh-plugin-client-template` | 客户端（浏览器）：创建 Canvas 交互组件，DOM 扫描与变更监听 |

---

## 二、整体架构

### 2.1 设计原则

DSH 遵循 **"一切皆插件"** 架构：宿主框架提供 Cordis 上下文（`ctx`），插件以独立包的形式挂载，通过 `apply(ctx, config)` 注入能力。本插件作为事件消费者与 UI 贡献者，不侵入 Agent Loop。

### 2.2 双半区客户端插件机制（关键）

DSH 的浏览器端插件是 **"双半区"包**：

```mermaid
flowchart LR
    A[客户端插件包<br/>dsh-plugin-client-template] --> B[Node 半区<br/>host.ts 空插件]
    A --> C[浏览器半区<br/>index.ts Canvas 交互]
    B --> D[loader 条目<br/>宿主侧挂载 fiber 存活]
    C --> E[dsh-client-modules 扫描<br/>exports[./client]]
    D --> F[编入 window.__DSH_BOOT__ 图]
    E --> F
    F --> G[浏览器加载<br/>__ModuleLoader__.load 自注册 bundle]
```

- **Node 半区**（`src/host.ts`，即 `package.json` 的 `main`）：一个**空的 Cordis 插件**（`export function apply() {}`），让 loader 条目在宿主侧成功挂载（fiber 存活），从而被 `dsh-client-modules` 扫描并编入 `window.__DSH_BOOT__` 图。
- **浏览器半区**（`src/index.ts`，即 `exports["./client"]`）：真正的浏览器逻辑，构建为 CJS 并以 `window.__ModuleLoader__.load({ id, factory })` **自注册**。

### 2.3 宿主 / 客户端分工

| 侧 | 进程 | 能力 | 本插件使用 |
|---|---|---|---|
| 宿主侧 | Node | 事件监听、HTTP 路由、LLM、持久化 | 注册 `/dsh-plugin-host-template-test` 路由 |
| 客户端侧 | 浏览器 | DOM 渲染、用户交互 | 创建 Canvas 蓝色块、DOM 扫描、`MutationObserver` 监听 |

---

## 三、目录结构

```
<项目根目录>/dsh-plugin-create-template/
├── package.json               # 项目配置 + workspace 声明 + 统一脚本
├── pnpm-workspace.yaml        # pnpm workspace（packages/*）
├── pnpm-lock.yaml
├── tsconfig.json              # TypeScript 基础配置（ES2024 / ESNext）
├── tsdown.config.ts           # 构建配置（三产物）
├── vitest.config.ts           # 测试配置（jsdom + node 双环境）
├── cordis.yml                 # 本地开发 patch 注册（按包名挂载）
├── AGENT.md                   # 项目智能体说明（操作指令 / 规范 / 红线）
├── README.md                  # 项目入口说明
├── LICENSE                    # MIT
├── .npmrc / .gitignore
├── packages/
│   ├── dsh-plugin-host-template/
│   │   ├── package.json       # 宿主包配置（dsh.bundle.patch）
│   │   ├── cordis.patch.yml   # 宿主插件注册配置
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── src/index.ts       # 宿主入口：HTTP 路由注册
│   │   ├── __tests__/index.test.ts
│   │   └── dist/              # 构建产物（ESM）
│   └── dsh-plugin-client-template/
│       ├── package.json       # 客户端包配置（dsh.client + exports["./client"]）
│       ├── cordis.patch.yml   # 客户端插件注册配置
│       ├── tsconfig.json
│       ├── README.md
│       ├── src/
│       │   ├── index.ts       # 浏览器半区：Canvas 交互
│       │   └── host.ts        # Node 半区：空插件
│       ├── __tests__/index.test.ts
│       └── dist/              # 构建产物（host.js ESM + index.cjs 浏览器 bundle）
├── scripts/
│   ├── auto-register.js       # 跨平台自动注册主脚本（幂等）
│   ├── auto-register.cmd      # Windows 委托入口
│   ├── auto-register.sh       # Linux/macOS 委托入口
│   └── wrap-client-bundle.mjs # 客户端 bundle 自注册包装
├── types/
│   └── deepseek-ai.d.ts       # @deepseek-ai 包模拟类型（本地开发/测试）
├── docs/
│   └── template.md            # 本文档
├── issues/                    # 问题记录（4 个已解决）
│   ├── README.md
│   └── 001~004-*.md
├── rules/
│   └── issues_rules.md        # 个人信息脱敏规则
└── .github/
    └── ISSUE_TEMPLATE/        # GitHub Issue 模板
```

---

## 四、技术栈

| 类别 | 选型 |
|---|---|
| 语言 | TypeScript 5（ESM，`type: module`） |
| 插件框架 | Cordis（`@deepseek-ai/cordis`），`ctx.effect` 生命周期托管 |
| 客户端运行时 | `@deepseek-ai/dsh-client-runtime/client`（`ClientContext`） |
| 构建工具 | tsdown（多入口三产物） |
| 测试框架 | Vitest（node + jsdom 双环境） |
| 包管理 | pnpm workspace |
| 运行环境 | Node.js（宿主）+ Browser（客户端） |

> 类型说明：`types/deepseek-ai.d.ts` 提供 `@deepseek-ai/*` 的**本地模拟类型**（tsconfig `paths` 与 vitest `alias` 均指向它），实际运行时由 DSH 宿主框架提供真实实现。

---

## 五、宿主端插件（dsh-plugin-host-template）

### 5.1 插件规范

```typescript
export const name = 'dsh-plugin-host-template'
export const inject = ['webServer']
```

- 依赖注入：`webServer`（由 `dsh-host-webserver` 提供）。
- 入口文件：[packages/dsh-plugin-host-template/src/index.ts](file:///<项目根目录>/packages/dsh-plugin-host-template/src/index.ts)

### 5.2 HTTP 路由

通过 `ctx.webServer.register()` 注册**路由对象**（注意：非 Express 风格 `(path, handler)`）：

| 项 | 值 |
|---|---|
| kind | `'exact'` |
| path | `/dsh-plugin-host-template-test` |
| 参数 | 无 |
| 返回 | `{ "serverTime": <epoch_ms> }` |
| 状态码 | 200，`content-type: application/json; charset=utf-8` |

**关键契约**（issue 004 修复点）：

1. `webServer.register` 接收 `{ kind, path, handler }` 路由对象；
2. `handler` 收到的是 `node:http` 原生 `IncomingMessage / ServerResponse`，**没有 `res.json()` 方法**，须用 `res.writeHead(...)` + `res.end(JSON.stringify(...))` 输出。

```typescript
ctx.webServer.register({
  kind: 'exact',
  path: '/dsh-plugin-host-template-test',
  handler: (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ serverTime: Date.now() }))
  },
})
```

### 5.3 注册配置

- 本地开发：`cordis.yml`（项目根）按包名挂载；
- 安装态：`packages/dsh-plugin-host-template/cordis.patch.yml` 声明 `dsh.bundle.patch`，由 `dsh plugin add` 安装进 profile 组合树。

---

## 六、客户端插件（dsh-plugin-client-template）

### 6.1 插件规范

```typescript
export const name = 'dsh-plugin-client-template'
export const inject = ['slots']
```

- 依赖注入：`slots`（仅浏览器端可用）。
- 浏览器入口：[packages/dsh-plugin-client-template/src/index.ts](file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts)
- Node 半区入口：[packages/dsh-plugin-client-template/src/host.ts](file:///<项目根目录>/packages/dsh-plugin-client-template/src/host.ts)

### 6.2 功能清单（MVP 占位）

| 功能 | 说明 |
|---|---|
| Canvas 创建 | 100×60 蓝色块（`#3b82f6`），`fixed` 定位右下角（`right:16px; bottom:16px`） |
| 点击事件 | 点击后控制台输出 `[SessionTag] Canvas clicked: { type, time, x, y }` |
| DOM 节点扫描 | `logSessionNodes()` 扫描 `[data-session-row]`、`[data-chat-anchor-key]`、`[data-conversation-scroll]`、`[data-sidebar-workspaces]` 并打印报告 |
| MutationObserver | 监听会话容器增删变化，输出节点数量统计 |
| 定时兜底 | 每 5s 检查一次会话节点数量并打印 |
| 清理钩子 | 挂到 `window.__sessionTagCleanup`，可断开监听、清除定时器、移除 Canvas |

**安全 DOM 辅助**：`safeQueryAll` / `safeQuery` 对 `querySelectorAll/querySelector` 做 try/catch 兜底，避免异常环境抛错中断插件。

### 6.3 双半区包清单（关键）

`packages/dsh-plugin-client-template/package.json`：

```json
{
  "name": "dsh-plugin-client-template",
  "type": "module",
  "main": "./dist/host.js",
  "exports": {
    ".": "./dist/host.js",
    "./client": "./dist/index.cjs",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": { "platform": "web" }
  }
}
```

**要点**（issue 004 修复点）：

1. `main` 指向 Node 半区 `dist/host.js`（空插件）；
2. `exports["./client"]` 指向浏览器 bundle `dist/index.cjs`，供 `dsh-client-modules` 扫描；
3. `dsh.client` 必须是**对象** `{ platform: "web" }`，字符串形式（如 `"./dist/index.js"`）不是合法声明；
4. bundle 须以 `window.__ModuleLoader__.load({ id, factory })` 自注册（见第七章）。

### 6.4 挂载条件

客户端插件**仅安装为依赖不会进入浏览器加载链路**，必须满足：

- 作为 loader 条目插入 profile 组合树（如 `<用户主目录>\.dsh\profiles\web\cordis.patch.yml` 的 `- insert:`）；
- 条目按**包名**挂载（不能 `file://` 源码路径，`dsh-client-modules` 按包名解析 `package.json`）。

---

## 七、构建与打包

### 7.1 构建命令

```bash
pnpm build   # = tsdown && node scripts/wrap-client-bundle.mjs
```

### 7.2 三产物（tsdown.config.ts）

| 入口 | 格式 | 产物 | 用途 |
|---|---|---|---|
| `packages/dsh-plugin-host-template/src/index.ts` | ESM | `dsh-plugin-host-template/dist/index.js` | 宿主插件（Node） |
| `packages/dsh-plugin-client-template/src/host.ts` | ESM | `dsh-plugin-client-template/dist/host.js` | 客户端 Node 半区（空插件） |
| `packages/dsh-plugin-client-template/src/index.ts` | CJS | `dsh-plugin-client-template/dist/index.cjs` | 客户端浏览器半区 |

- 宿主产物 `external: ['@deepseek-ai/*']`；
- target 均为 `es2024`。

### 7.3 客户端 bundle 自注册包装

tsdown **不支持输出尾部包装**，因此由 [scripts/wrap-client-bundle.mjs](file:///<项目根目录>/scripts/wrap-client-bundle.mjs) 在构建后把 `dist/index.cjs` 拼装成 DSH 要求的自注册格式（与官方 `dsh-client-runtime/lib/client.js` 一致）：

```js
window.__ModuleLoader__.load({
  id: "dsh-plugin-client-template",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // ...CJS 主体...
    return module.exports;
  }
});
```

- 已含 `window.__ModuleLoader__.load(` 则跳过（幂等）；
- 每行缩进 4 空格、`Object.defineProperty(exports, Symbol.toStringTag, ...)` 保证 ESM 互操作。

---

## 八、开发与调试

### 8.1 安装依赖

```bash
pnpm install
```

### 8.2 本地开发（宿主端 + 客户端按包名）

```bash
pnpm run dev   # = dsh web --patch cordis.yml
```

`cordis.yml` 内容（**按包名挂载**，host 走包 `main`、client 浏览器半区由 `dsh-client-modules` 扫描）：

```yaml
- insert:
    - id: dsh-plugin-host-template
      name: dsh-plugin-host-template
    - id: dsh-plugin-client-template
      name: dsh-plugin-client-template
```

> 注意：必须从项目根目录运行，避免识别失败；修改源码后需 `pnpm build` 再启动。

### 8.3 自动注册（安装到 DSH profile）

```bash
pnpm run register        # node scripts/auto-register.js（跨平台）
pnpm run register:win    # Windows
pnpm run register:unix   # Linux/macOS
```

[scripts/auto-register.js](file:///<项目根目录>/scripts/auto-register.js) 执行五步（[1/5]~[5/5]）：

| 步骤 | 动作 |
|---|---|
| [1/5] | `pnpm build` 构建插件 |
| [2/5] | `dsh plugin --profile web add` 安装宿主包 |
| [3/5] | `dsh plugin --profile web add` 安装客户端包 |
| [4/5] | **幂等**校验 profile 的 `cordis.patch.yml`：已含 `dsh-plugin-client-template` 条目则跳过；否则追加 `- insert:` 条目（防止 profile 重建后客户端插件静默丢失） |
| [5/5] | 完成提示 |

**幂等设计**（核心修复）：用 `new RegExp(\`- id: ${CLIENT_LOADER_ID}\\b\`)` 正则判断是否已存在条目，重复执行不会产生重复条目；写入采用整体拼接写回，规避 `appendFileSync` 换行边界问题。`.cmd` / `.sh` 已简化为委托给 JS 主脚本，保证三平台逻辑一致。

安装后需**重启 DSH** 生效。

### 8.4 手动安装

```bash
dsh plugin --profile web add <项目根目录>/packages/dsh-plugin-host-template
dsh plugin --profile web add <项目根目录>/packages/dsh-plugin-client-template
dsh web
```

### 8.5 类型检查 / 测试

```bash
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:coverage    # vitest run --coverage
```

---

## 九、测试

[vitest.config.ts](file:///<项目根目录>/vitest.config.ts) 双环境 + `@deepseek-ai/*` 别名模拟：

```ts
environmentMatchGlob: [
  ['packages/dsh-plugin-client-template/**', 'jsdom'],
  ['packages/dsh-plugin-host-template/**', 'node'],
],
```

当前 18 个用例（host 5 + client 13）：

| 包 | 覆盖点 |
|---|---|
| host（5） | `name` 规范、`inject` 含 `webServer`、路由对象注册（kind/path/handler）、响应 JSON 含 `serverTime`、路径前缀 `/dsh-plugin-host-template-` |
| client（13） | `name` / `inject` 规范、Canvas 创建与尺寸（100×60）、fixed 右下角样式、`data-session-tag-canvas` 属性、挂载到 body、ctx/slots 日志、挂载日志、MutationObserver 启动、cleanup 函数、DOM 扫描报告 |

> 客户端测试用 `@vitest-environment jsdom`，并在 `beforeEach` 清理残留 DOM 与 `window.__sessionTagCleanup`。

---

## 十、已解决问题与排查指南

问题记录统一存放于 [issues/](file:///<项目根目录>/issues)，模板位于 `.github/ISSUE_TEMPLATE/`。以下 4 个问题均已解决，按"客户端插件加载链路"的因果关系整理：

| 编号 | 问题 | 根因 | 解决方案 |
|---|---|---|---|
| 001 | `cordis.yml --patch` 加载客户端插件时等待 `slots` 服务超时 | `slots` 仅浏览器可用，Node 宿主上下文无此服务 | `cordis.yml` 仅注册宿主插件；客户端走 `dsh plugin add` / `dsh.client` |
| 002 | Windows 绝对路径不兼容 ESM 加载器（`Received protocol 'c:'`） | ESM 只认 `file://` / `data:` / `node:` 协议 | 用 `file:///` URL 或按包名挂载 |
| 003 | `dsh web`（无 `--patch`）时 profile `node_modules` 找不到包 | 仅注册未安装 | 先 `dsh plugin add` 安装，或用 `--patch` 开发 |
| 004 | host/client 在 web profile 中均未正确加载（路由 404、客户端未进 `__DSH_BOOT__`） | 宿主 API 误用 + 客户端协议不满足（`dsh.client` 字符串、缺 `exports["./client"]`、裸 CJS 未自注册、`main` 指向错误产物）+ 未挂载 loader 条目 | 路由对象注册；双半区包改造；`__ModuleLoader__.load` 自注册；profile patch 挂载 |

### 排查速查表

| 现象 | 排查点 |
|---|---|
| 宿主路由 404 | `webServer.register` 是否传路由对象 `{kind,path,handler}`；handler 是否用 `writeHead`+`end` |
| 客户端未渲染 | ① profile `cordis.patch.yml` 是否有条目 ② 条目是否按包名 ③ `package.json` 是否 `dsh.client` 对象 + `exports["./client"]` ④ bundle 是否自注册 ⑤ 是否已 `pnpm build` |
| Windows 启动失败 | `cordis.yml` 是否误用盘符路径 |
| 未生效（改了代码） | 是否重新 `pnpm build` 并重启 `dsh web` |

---

## 十一、关键工程决策与踩坑记录

1. **双包拆分**：宿主与客户端物理隔离，各自独立 `package.json` / `cordis.patch.yml`，职责清晰、可独立发布。
2. **客户端插件 = 双半区包**：Node 半区空插件保证 loader 挂载，浏览器半区经 `dsh.client` + `exports["./client"]` + 自注册 bundle 交付——这是 DSH 浏览器插件协议的核心形态。
3. **`webServer.register` 是路由对象签名**：`{ kind, path, handler }`，handler 收到原生 `req/res`；`types/deepseek-ai.d.ts` 类型桩须与运行时契约保持一致（曾因旧签名掩盖真实差异）。
4. **构建自注册包装**：tsdown 不支持 footer，用 `wrap-client-bundle.mjs` 拼装 `window.__ModuleLoader__.load({ id, factory })`，与官方 bundle 格式一致。
5. **自动注册幂等**：`ensureClientPatchEntry()` 保证客户端条目在 profile 重建后自动补齐、重复执行不重复——避免"客户端插件静默不加载"这类难排查问题。
6. **测试环境分离**：client 用 jsdom、host 用 node，`@deepseek-ai/*` 走本地类型桩 alias，保证无真实宿主也能跑单测。
7. **已知遗留**：仓库中 `dsh-plugin-create-template`、`organize-workspace-sessions` 等包在 web profile 中仍存在未挂载情况（issue 004 遗留备注，不在当前范围内）。

---

## 十二、后续规划

当前为 MVP 验证期，以下设计愿景尚未实现（早期设计稿曾记录于本文档，因与代码脱节已移除，后续按需以"先设计后实现"的方式落回）：

| 能力 | 状态 | 依赖链路 |
|---|---|---|
| 会话标签分析（`turn/end` → 异常终止/等待/完结/无效/进行中） | 未实现 | `session/event` 监听 + `ctx.llm` |
| 标签投影到 Web UI（背景色渲染） | 未实现 | `ctx.sessionProjections` + 客户端槽位/CSS 定位 |
| 每日 17:00 会话梳理提醒 | 未实现 | 浏览器 `Notification` |
| Web UI 手动改标签 | 未实现 | Typert RPC / 宿主 HTTP 接口 |

> 新增能力前需遵守 `AGENT.md` 红线：涉及宿主接口、投影注册、客户端槽位等跨层契约的改动，须先核对官方 API 文档；涉及会话数据结构、投影 schema 的改动须先与用户确认。
