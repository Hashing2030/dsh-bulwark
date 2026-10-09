# dsh-bulwark

DeepSeek Harness (DSH) 插件：向 `systemPrompt` 注入守则段，并在工具调用层拦截受保护路径的修改与受保护插件的卸载。

## 功能

- **守则注入**：把一个可配置的守则段写进 `systemPrompt`，位置由中心顺序表推导。
- **路径保护**：`tools.guard` 拦截对 `protectedPaths` 内路径的写 / 删 / 移动（含相对路径与 `cd` 链的解析）。
- **插件卸载保护**：命中 `protectedRemovalPatterns` 关键词的卸载 / 删除命令一律拦截。
- **配置热重载**：`watch` 监听 `config.json`，改动后无需重启。
- **逃生通道**：`DSH_FORTRESS_DISABLE=1` 可一键禁用整个插件。

## 目录结构（卡 8 起为单包）

```
dsh-bulwark/
├── package.json          # 单包 manifest，main → dist/index.js
├── cordis.yml            # bundle patch：insert 一条 dsh-bulwark loader 条目
├── cordis.patch.yml      # 与 cordis.yml 同内容的惯例副本
├── tsdown.config.ts      # 构建配置（单 entry）
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # 唯一入口（守则段 + tools.guard + 配置）
│   └── shell-tokenizer.ts# shell 命令切分（纯函数）
├── tests/
│   ├── e2e.test.ts       # 71 条端到端回归
│   └── shell-tokenizer.test.ts
├── scripts/protect.sh    # 配置管理 CLI
├── types/deepseek-ai.d.ts
└── dist/                 # 构建产物（随包提交）
```

## 安装

```bash
# 从 GitHub 安装（dist/ 已随包提交，无需本地构建）
dsh plugin add github:Hashing2030/dsh-bulwark

# 本地开发时用 patch 加载
dsh web --patch cordis.yml
```

安装后重启 DSH 生效。

## 构建

```bash
pnpm install
pnpm build          # tsdown → dist/index.js
```

## 测试

```bash
pnpm test:e2e       # 等价于 node --experimental-strip-types tests/e2e.test.ts
```

## 配置

配置文件：`$DSH_HOME/dsh-bulwark/config.json`（`DSH_HOME` 未设置时退回 `~/.dsh`）。

```json
{
  "rulesText": "[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。",
  "protectedPaths": [],
  "protectedRemovalPatterns": [{ "keywords": ["dsh-bulwark"] }]
}
```

用 CLI 管理，不要手改 JSON：

```bash
./scripts/protect.sh add /path/to/protect
./scripts/protect.sh list
./scripts/protect.sh test "rm -rf /path/to/protect/foo"
```

## 逃生通道

```bash
DSH_FORTRESS_DISABLE=1 dsh web      # 完全不加载 dsh-bulwark
```

## 相关文档

- [配置说明](CONFIG.md)
- [脚本用法](SCRIPT-USAGE.md)
- [灾难恢复](DISASTER-RECOVERY.md)
- [测试说明](TESTING.md)
- [迁移记录](MIGRATION.md)

## 许可证

MIT
