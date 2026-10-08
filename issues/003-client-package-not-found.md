---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] 客户端插件在 DSH profile 的 node_modules 中找不到'
labels: ['bug']
assignees: ''
---

## 描述缺陷

在本地开发环境中，不使用 `--patch` 参数直接运行 `dsh web` 时，DSH 尝试从 `~/.dsh/profiles/web/node_modules/` 加载客户端插件，但找不到该包。

## 复现步骤

1. 确保 `cordis.yml` 中注册了客户端插件：
   ```yaml
   - insert:
       - id: dsh-session-base-client
         name: dsh-session-base-client
   ```
2. 执行 `dsh web`（不带 `--patch` 参数）
3. DSH 启动失败，报错如下：

## 预期行为

DSH 正常启动并加载客户端插件。

## 实际行为

DSH 启动失败，错误信息：
```
Error: Cannot find package '<用户主目录>\.dsh\profiles\web\node_modules\dsh-session-base-client\dist\index.js'
```

## 环境信息

- dsh 版本：`dsh --version`（最新版）
- 插件版本：`dsh plugin list`
- 操作系统：Windows 11
- Node.js 版本：v24.13.1

## 日志 / 报错

```
PS <项目根目录>> dsh web
file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****
                throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause });
                      ^

Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to import loader entry dsh-session-base-client (dsh-session-base-client): Cannot find package '<用户主目录>\.dsh\profiles\web\node_modules\dsh-session-base-client\dist\index.js' imported from <用户主目录>\.dsh\profiles\web\
Error: Cannot find package '<用户主目录>\.dsh\profiles\web\node_modules\dsh-session-base-client\dist\index.js' imported from <用户主目录>\.dsh\profiles\web\
    at legacyMainResolve (node:internal/modules/esm/resolve:****)
    at packageResolve (node:internal/modules/esm/resolve:****)
    at moduleResolve (node:internal/modules/esm/resolve:****)
    at defaultResolve (node:internal/modules/esm/resolve:****)
    ...
```

## 根因分析

当不使用 `--patch` 参数运行 `dsh web` 时，DSH 会从 `~/.dsh/profiles/web/node_modules/` 加载已安装的插件。如果插件仅在 `cordis.yml` 中注册但未通过 `dsh plugin add` 安装，DSH 无法找到该包。

## 解决方案

1. **使用 `--patch` 参数进行本地开发**：
   ```bash
   dsh web --patch cordis.yml
   ```

2. **或先安装插件到 DSH profile**：
   ```bash
   dsh plugin add <项目根目录>/packages/dsh-plugin-client-template
   dsh web
   ```

## 其他补充

- 此问题在初次本地开发时容易遇到
- 建议在文档中明确说明两种启动方式的区别
- `--patch` 参数仅用于加载宿主端插件的本地源文件
