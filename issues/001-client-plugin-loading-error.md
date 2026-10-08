---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] 客户端插件通过 cordis.yml --patch 加载时等待 slots 服务超时'
labels: ['bug']
assignees: ''
---

## 描述缺陷

在本地开发环境中，通过 `cordis.yml` 配合 `--patch` 参数同时注册宿主端和客户端插件时，客户端插件因等待 `slots` 服务而无法激活，导致 DSH 启动失败。

## 复现步骤

1. 在 `cordis.yml` 中同时注册宿主端和客户端插件：
   ```yaml
   - insert:
       - id: dsh-session-base-host
         name: file:///<项目根目录>/packages/dsh-plugin-host-template/src/index.ts
       - id: dsh-session-base-client
         name: file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts
   ```
2. 执行 `pnpm run dev` 或 `dsh web --patch cordis.yml`
3. DSH 启动失败，报错如下：

## 预期行为

DSH 正常启动，宿主端插件注册 HTTP 路由，客户端插件在浏览器中加载并渲染 Canvas。

## 实际行为

DSH 启动失败，错误信息：
```
Error: dsh: plugin tree failed to load: dsh: 1 entry did not activate
file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts: pending (waiting for service: slots)
```

客户端插件在 Node.js 宿主上下文中加载，但 `slots` 服务仅在浏览器客户端中可用。

## 环境信息

- dsh 版本：`dsh --version`（最新版）
- 插件版本：`dsh plugin list`
- 操作系统：Windows 11
- 浏览器（Web UI 相关）：Chrome / Edge

## 日志 / 报错

```
PS <项目根目录>> pnpm run dev
$ dsh web --patch cordis.yml
dsh web: http://127.0.0.1:****
dsh web: opening the default browser; pass --no-open to disable
file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****
                throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause });
                      ^

Error: dsh: plugin tree failed to load: dsh: 1 entry did not activate
file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts: pending (waiting for service: slots)
    at boot (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****)
    at async runProfile (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/lib/profile-boot-****.js:****)
    at async file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/lib/bin.js:**** {
  [cause]: Error: dsh: 1 entry did not activate
  file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts: pending (waiting for service: slots)
      at assertEntriesActivated (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****)
      at boot (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****)
      at async runProfile (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/lib/profile-boot-****.js:****)
      at async file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/lib/bin.js:**** {
  [cause]: AggregateError: loader entries failed to apply
      at EntryGroup.update (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:****)
      at async Include._apply (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****) {
    [errors]: [
      Error: failed to import loader entry dsh-session-base-client (file:///<项目根目录>/packages/dsh-plugin-client-template/src/index.ts): pending (waiting for service: slots)
    ]
  }
}
```

## 根因分析

`cordis.yml` 配合 `--patch` 参数仅用于加载**宿主端插件**（Node.js 环境）。客户端插件需要在浏览器环境中加载，由 DSH 客户端运行时通过 `dsh.client` 配置读取。

当客户端插件被注册到 `cordis.yml` 时，DSH 会尝试在 Node.js 宿主上下文中加载它，但客户端插件依赖的 `slots` 服务仅在浏览器中可用，导致加载失败。

## 解决方案

1. **`cordis.yml` 仅注册宿主端插件**：
   ```yaml
   - insert:
       - id: dsh-session-base-host
         name: file:///<项目根目录>/packages/dsh-plugin-host-template/src/index.ts
   ```

2. **客户端插件通过 `dsh plugin add` 安装**：
   ```bash
   dsh plugin add <项目根目录>/packages/dsh-plugin-client-template
   ```

3. **或使用独立的 `dsh.plugin` 配置**：
   ```json
   {
     "dsh": {
       "client": "./dist/index.js"
     }
   }
   ```

## 其他补充

- 此问题在双包拆分架构中容易遇到
- 建议在文档中明确说明 `cordis.yml` 仅用于宿主端插件
- 客户端插件的本地开发流程需要进一步优化
