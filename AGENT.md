# 项目说明

## 项目概述

本项目是基于 DeepSeek Harness (DSH) 插件系统构建的会话管理插件 **dsh-plugin-create-template**，帮助用户快速识别哪些会话需要重点跟进。

- 宿主框架：DeepSeek Harness (DSH) 插件系统（一切皆插件）
- 语言：TypeScript 5（ESM，package.json `type: module`）
- 插件框架：Cordis（`@deepseek-ai/cordis`），`ctx.effect` 生命周期托管
- 配置 Schema：Schemastery（`@deepseek-ai/schemastery`）
- 客户端：React + 客户端槽位（slots / clientRuntime / SessionStandardProps）
- 类型化 RPC：Typert RPC（构建时生成客户端桩 + 宿主服务桩）
- 双包拆分：`packages/dsh-plugin-host-template`（宿主）/ `packages/dsh-plugin-client-template`（客户端）

## 核心操作指令

- 安装依赖：`pnpm install`（仓库根目录与各 package 下分别执行）
- 本地开发启动：`pnpm dsh web --patch <绝对路径>/cordis.yml`（须从项目根目录运行，避免识别失败）
- 类型检查：`pnpm typecheck`（修改类型定义后必须执行）
- 构建打包：按各 package 的 `package.json` scripts 执行（如 `build` 生成 `dist/client.js` 等）
- 运行测试：`pnpm test`（Vitest 框架，ESM 原生支持）

## 代码风格规范

- 组件开发：优先使用函数式组件 + React Hooks，禁止使用类组件。
- 类型定义：必须使用 TypeScript 强类型约束，禁止使用 `any` 类型（特殊场景需注释说明）。
- 模块拆分：所有代码按功能点拆分模块文件，单文件行数不超过 800 行。
- 代码注释：采用「总体 → 定义 → 举例 → 详细」四层结构，使用中文注释。
- 命名规范：变量名直接反映含义，避免缩写。

## 安全与合规要求

- 敏感凭证：API 密钥、数据库连接信息必须从环境变量读取，严禁硬编码。
- 接口请求：客户端→宿主调用必须通过类型化 Typert RPC 或宿主注册的 `/dsh-plugin-host-template-*` HTTP 接口，禁止绕过封装直接访问。
- DOM 操作：客户端仅操作自身锚点定位的 DOM 节点区域，永不触碰宿主数据源之外的 DOM。

## 注意事项（红线）

- 绝对不要修改宿主框架（`node_modules`、`@deepseek-ai/*`）里的任何东西。
- 涉及宿主接口、投影注册、客户端槽位等跨层契约的改动，必须先查阅 `docs/` 下的官方 API 核对文档（`dsh-session-manager.md` / `dsh-tidychat.md`）。
- 涉及会话数据结构、投影 schema 的改动，必须先告知我。
- 代码注释和 Git 提交信息请使用中文。

## 项目约束规则（自动加载）

执行本项目任务时，必须自动加载以下项目规则文件，并以其为准：

- `./rules/openspec_rules.md` —— OpenSpec Agent 执行规则（优先级原则、技能查找、版本检查、配置加载）
- `./openspec/config.yaml` —— 项目上下文与工作流规则（技术栈、项目结构、workflow / tasks / proposal / design / specs / sync / execution 约束）
