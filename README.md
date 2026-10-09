# dsh-bulwark

DSH 插件：向 systemPrompt 注入守则段，并在工具调用层拦截受保护路径的修改与受保护插件的卸载。

## 功能

- **守则注入**：把一个可配置的守则段写进 systemPrompt，位置由中心顺序表推导。
- **路径保护**：拦截对 protectedPaths 内路径的写 / 删 / 移动（含相对路径与 cd 链解析、重定向、dd / truncate / tee、python / node 内联脚本）。
- **插件卸载保护**：命中 protectedRemovalPatterns 关键词的卸载 / 删除命令一律拦截。
- **配置热重载**：监听 config.json，改动后无需重启。
- **逃生通道**：一个环境变量即可完全禁用。

## 安装

```
dsh plugin add github:Hashing2030/dsh-bulwark
```

安装后重启 DSH 生效。

> **首次启动会看到一行提示**：
> `[dsh-bulwark:config] watcher unavailable, config changes need a restart: ENOENT...`
> 这不是错误。它表示 config.json 还没创建，热重载暂未启用。创建配置文件后此提示自动消失。

## 配置

配置文件路径：`$DSH_HOME/dsh-bulwark/config.json`（`DSH_HOME` 未设置时退回 `~/.dsh`）。

完整默认值：

```json
{
  "rulesText": "[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。",
  "protectedPaths": [],
  "protectedRemovalPatterns": [
    { "keywords": ["dsh plugin", "remove", "dsh-bulwark"] },
    { "keywords": ["dsh plugin", "remove", "dsh-plugin-host-template"] },
    { "keywords": ["dsh plugin", "remove", "dsh-plugin-client-template"] },
    { "keywords": ["pnpm", "remove", "dsh-bulwark"] },
    { "keywords": ["npm", "uninstall", "dsh-bulwark"] }
  ]
}
```

字段说明见 [CONFIG.md](CONFIG.md)。

## 用 CLI 管理配置（推荐）

不建议手改 JSON。用 scripts/protect.sh：

```
# 从插件安装目录进入（路径按实际 profile 替换）
cd ~/.dsh/profiles/web/node_modules/dsh-bulwark

./scripts/protect.sh add /path/to/protect
./scripts/protect.sh list
./scripts/protect.sh remove /path/to/protect
./scripts/protect.sh test "rm -rf /path/to/protect/foo"
./scripts/protect.sh set-rules "[dsh-bulwark 守则] 新的守则内容"
```

也可以克隆一份仓库，用仓库里的脚本操作同一个配置文件：

```
git clone https://github.com/Hashing2030/dsh-bulwark
cd dsh-bulwark
./scripts/protect.sh add /path/to/protect
```

完整命令说明见 [SCRIPT-USAGE.md](SCRIPT-USAGE.md)。

## 逃生通道

```
DSH_FORTRESS_DISABLE=1 dsh web
```

设置这个环境变量后，DSH 启动时完全不加载 dsh-bulwark。清除即恢复。

> 变量名 DSH_FORTRESS_DISABLE 中的 FORTRESS 是项目旧名（dsh-fortress）的遗留。改名时保留它是为了不破坏已有配置。

## 本地开发

```
pnpm install
pnpm build          # tsdown → dist/index.js
dsh web --patch cordis.yml    # 用源码路径加载，不用装
```

## 测试

```
pnpm test:e2e       # 71 条端到端回归
```

## 相关文档

- [配置说明](CONFIG.md)
- [脚本用法](SCRIPT-USAGE.md)
- [灾难恢复](DISASTER-RECOVERY.md)
- [测试说明](TESTING.md)
- [迁移记录](MIGRATION.md)

## 许可证

MIT