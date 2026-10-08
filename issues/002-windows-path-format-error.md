---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] Windows 绝对路径格式不兼容 ESM 加载器'
labels: ['bug']
assignees: ''
---

## 描述缺陷

在 Windows 环境下，`cordis.yml` 中使用 `C:/...` 格式的绝对路径时，Node.js ESM 加载器无法识别该路径格式，报错 `Received protocol 'c:'`。

## 复现步骤

1. 在 `cordis.yml` 中使用 Windows 绝对路径：
   ```yaml
   - insert:
       - id: dsh-session-base-host
         name: <项目根目录>/packages/dsh-plugin-host-template/src/index.ts
   ```
2. 执行 `pnpm run dev` 或 `dsh web --patch cordis.yml`
3. DSH 启动失败，报错如下：

## 预期行为

DSH 正常识别 Windows 绝对路径并加载插件。

## 实际行为

DSH 启动失败，错误信息：
```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'
```

## 环境信息

- dsh 版本：`dsh --version`（最新版）
- 插件版本：`dsh plugin list`
- 操作系统：Windows 11
- Node.js 版本：v24.13.1

## 日志 / 报错

```
PS <项目根目录>> pnpm run dev
$ dsh web --patch cordis.yml
file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:****
                throw new Error(`${binName}: ${stage}: ${detail}${stack}`, { cause });
                      ^

Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply
AggregateError: loader entries failed to apply
    at EntryGroup.update (file:///<用户主目录>/AppData/Local/nvm/v24.13.1/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js:****)
    ...
    [errors]: [
      Error: failed to import loader entry dsh-session-base-host (<项目根目录>/packages/dsh-plugin-host-template/src/index.ts): Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'
          ...
          code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
      }
    ]
```

## 根因分析

Node.js ESM 加载器在 Windows 环境下要求绝对路径使用 `file://` URL 格式。`C:/path/to/file` 格式会被解析为协议 `c:`，而 ESM 加载器仅支持 `file://`、`data:` 和 `node:` 协议。

## 解决方案

在 `cordis.yml` 中使用 `file://` URL 格式：

```yaml
- insert:
    - id: dsh-session-base-host
      name: file:///<项目根目录>/packages/dsh-plugin-host-template/src/index.ts
```

## 其他补充

- 此问题仅在 Windows 环境下出现
- macOS/Linux 环境下直接使用 `/path/to/file` 格式即可
- 建议在文档中说明 Windows 环境下的路径格式要求
