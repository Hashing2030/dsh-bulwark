# dsh-plugin-create-template

DeepSeek DSH 插件 - 会话管理，帮助用户快速识别哪些会话需要重点跟进。

## 项目概述

本项目是基于 DeepSeek Harness (DSH) 插件系统构建的会话管理插件，采用双包拆分架构：

- **宿主端插件** (`dsh-plugin-host-template`)：HTTP 接口实现
- **客户端插件** (`dsh-plugin-client-template`)：Canvas 交互实现

## 目录结构

```
dsh-plugin-create-template/
├── package.json                    # 项目配置 + workspace 声明
├── cordis.yml                      # 本地开发 patch 注册（宿主端）
├── tsconfig.json                   # TypeScript 基础配置
├── tsdown.config.ts                # 构建配置（双产物）
├── vitest.config.ts                # 测试配置
├── packages/
│   ├── dsh-plugin-host-template/
│   │   ├── package.json            # 宿主包配置
│   │   ├── cordis.patch.yml        # 插件注册配置
│   │   ├── src/index.ts            # 宿主入口：HTTP 路由注册
│   │   └── dist/                   # 构建产物
│   └── dsh-plugin-client-template/
│       ├── package.json            # 客户端包配置
│       ├── src/index.ts            # 客户端入口：Canvas 交互
│       └── dist/                   # 构建产物
├── docs/                           # 设计文档
└── openspec/                       # OpenSpec 变更管理
```

## 安装依赖

```bash
# 在项目根目录执行
pnpm install
```

## 本地开发

### 方式 1：宿主端插件本地开发（推荐）

使用 `--patch` 参数加载本地源文件，仅测试宿主端插件：

```bash
# 启动开发服务器
pnpm run dev

# 或手动执行
dsh web --patch cordis.yml
```

**注意**：客户端插件需要通过方式 2 安装后才能在浏览器中加载。

### 方式 2：分别安装两个插件包

将宿主端和客户端插件分别安装到 DSH profile：

```bash
# 自动注册（推荐）
pnpm run register

# 或手动执行
# 1. 安装宿主端插件
dsh plugin add <项目根目录>/packages/dsh-plugin-host-template

# 2. 安装客户端插件
dsh plugin add <项目根目录>/packages/dsh-plugin-client-template

# 3. 重启 DSH
dsh web
```

**自动注册脚本说明：**

| 脚本 | 平台 | 使用方式 |
|------|------|----------|
| `scripts/auto-register.js` | 跨平台 | `node scripts/auto-register.js` 或 `pnpm run register` |
| `scripts/auto-register.cmd` | Windows | `scripts\auto-register.cmd` 或 `pnpm run register:win` |
| `scripts/auto-register.sh` | Linux/macOS | `./scripts/auto-register.sh` 或 `pnpm run register:unix` |

**安装后需要重启 DSH 才能生效。**

## 构建

```bash
# 构建双产物（Host ESM + Client CJS）
pnpm build
```

构建产物：
- `packages/dsh-plugin-host-template/dist/index.js`（ESM，Node.js）
- `packages/dsh-plugin-client-template/dist/index.cjs`（CJS，Browser）

## 测试

```bash
# 运行所有测试
pnpm test

# 运行宿主端测试
pnpm test --filter dsh-plugin-host-template

# 运行客户端测试
pnpm test --filter dsh-plugin-client-template

# 生成覆盖率报告
pnpm test:coverage
```

## 类型检查

```bash
pnpm typecheck
```

## 插件配置说明

### 宿主端插件 (`dsh-plugin-host-template`)

- **注册方式**：通过 `cordis.patch.yml` 或 `cordis.yml` 配合 `--patch` 参数
- **HTTP 接口**：`/dsh-plugin-host-template-test`
- **返回格式**：`{ "serverTime": <epoch_ms> }`

### 客户端插件 (`dsh-plugin-client-template`)

- **加载方式**：通过 `dsh.client` 配置，由 DSH 客户端运行时加载
- **功能**：在 DOM 节点区域创建 Canvas 元素，绘制蓝色块支持点击
- **交互**：点击后控制台输出日志 `[SessionTag] Canvas clicked: {...}`

## 技术栈

- **语言**：TypeScript 5（ESM）
- **插件框架**：Cordis（`@deepseek-ai/cordis`）
- **构建工具**：tsdown
- **测试框架**：Vitest
- **运行环境**：Node.js（宿主）+ Browser（客户端）

## 相关文档

- [宿主端插件 README](packages/dsh-plugin-host-template/README.md)
- [客户端插件 README](packages/dsh-plugin-client-template/README.md)
- [设计文档](openspec/changes/session-tag-basic/design.md)
- [提案文档](openspec/changes/session-tag-basic/proposal.md)

## 许可证

MIT
