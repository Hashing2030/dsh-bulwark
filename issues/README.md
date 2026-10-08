# 问题反馈

问题反馈渠道：[Issue](https://github.com/jackdizhu/dsh-session-tag-manage/issues)

## Issue 模板

模板统一存放于仓库根目录 `.github/ISSUE_TEMPLATE/`（GitHub 新建 Issue 时自动应用），本目录不再保存模板副本：

| 文件 | 用途 |
|---|---|
| `bug_report.md` | 缺陷报告（标签：bug） |
| `feature_request.md` | 功能建议（标签：enhancement） |
| `question.md` | 问题咨询（标签：question） |
| `config.yml` | 模板选择器配置（禁止空白 Issue） |

> 维护提示：模板修改请直接编辑 `.github/ISSUE_TEMPLATE/` 下对应文件。

## 已记录的问题

| 文件 | 问题描述 | 状态 |
|---|---|---|
| `001-client-plugin-loading-error.md` | 客户端插件通过 cordis.yml --patch 加载时等待 slots 服务超时 | 已解决 |
| `002-windows-path-format-error.md` | Windows 绝对路径格式不兼容 ESM 加载器 | 已解决 |
| `003-client-package-not-found.md` | 客户端插件在 DSH profile 的 node_modules 中找不到 | 已解决 |
| `004-plugin-loading-failure-in-web-profile.md` | dsh-session-base-host / dsh-session-base-client 在 web profile 中未正确加载（路由 404、客户端插件未进入 __DSH_BOOT__） | 已解决 |
