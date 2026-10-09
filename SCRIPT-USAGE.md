# protect.sh 使用说明

`scripts/protect.sh` 是 dsh-bulwark 的 CLI 配置管理工具。

**为什么存在**：v2 决定不做 GUI。卡 6 探测过 DSH 的 settings API，它只暴露
`ctx.settings.configure/describe/update` 这类服务端表单能力，没有给第三方插件留
「注册一个设置页 / 一个设置项」的扩展点（没有 `installSection`、没有 `register`），
强行承载只会把配置管理绑死在 DSH 版本上。所以配置管理改走脚本路线：一个纯 bash +
node 的小工具，直接读写 config.json，不依赖 DSH 运行时。

**它做什么**：维护 `protectedPaths`（受保护路径清单）、读写 `rulesText`（注入
systemPrompt 的守则文本）、打印完整配置，以及调用插件自己的判断函数来预演一条
bash 命令会不会被拦。

**它不做什么**：不启动 DSH、不跑测试、不做环境探索；也不会复制一份判断逻辑
（`test` 子命令是动态 import 插件的源码来调用导出函数）。

---

## 1. 子命令

```
protect.sh <子命令> [参数]
```

| 子命令 | 作用 |
| --- | --- |
| `add <path>` | 把路径加入 `protectedPaths`（归一化后去重） |
| `remove <path>` | 从 `protectedPaths` 移除（归一化后匹配） |
| `list` | 逐行打印 `protectedPaths` |
| `rules` | 打印当前 `rulesText` |
| `set-rules <text>` | 替换 `rulesText`（多个参数按空格拼接） |
| `show` | 打印完整 config.json（格式化 JSON） |
| `test <command>` | 判断一条 bash 命令会被拦还是放行 |
| `help` / `--help` | 显示帮助 |

### 1.1 add

路径会先归一化，规则与插件内部 `normalizePath` 一致：先 `realpathSync`（解析符号
链接、把 `/var` 收敛成 `/private/var`），失败（路径不存在、无权限）回退
`path.resolve`。相对路径按当前工作目录解析。已在列表里（归一化后相等）则输出
`already protected`，不重复添加。

```console
$ ./scripts/protect.sh add /tmp/test-protect-1
protected: /tmp/test-protect-1

$ ./scripts/protect.sh add /tmp/test-protect-1
already protected
```

### 1.2 remove

同样归一化后匹配。不在列表里不算错误（exit 0），只是不写文件。

```console
$ ./scripts/protect.sh remove /tmp/test-protect-1
unprotected: /tmp/test-protect-1

$ ./scripts/protect.sh remove /tmp/test-protect-1
not protected: /tmp/test-protect-1
```

### 1.3 list

逐行打印，一行一个路径，没有额外装饰，方便被别的脚本消费。

```console
$ ./scripts/protect.sh list
/Users/liuzhaoyang/dsh-fortress-dev
```

### 1.4 rules

```console
$ ./scripts/protect.sh rules
[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。
```

### 1.5 set-rules

多个参数按空格拼接，所以文本里带空格时加引号即可；空文本会被拒绝（exit 非 0），
因为插件把空 `rulesText` 视为无效并回退默认值。

```console
$ ./scripts/protect.sh set-rules "[dsh-bulwark 守则] 新的守则内容"
rules updated

$ ./scripts/protect.sh rules
[dsh-bulwark 守则] 新的守则内容
```

### 1.6 show

打印格式化后的完整 config.json（`protectedRemovalPatterns` 等其它字段一并显示）。

```console
$ ./scripts/protect.sh show
{
  "rulesText": "[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。",
  "protectedPaths": [
    "/Users/liuzhaoyang/dsh-fortress-dev"
  ],
  "protectedRemovalPatterns": [
    {
      "keywords": [
        "dsh plugin",
        "remove",
        "dsh-bulwark"
      ]
    }
  ]
}
```

### 1.7 test

动态 `import` 插件的 `src/index.ts`，调用它的
`isProtectedRemoval` / `isProtectedPathModification`，输出 `BLOCKED` 或 `ALLOWED`；
被拦时附一行 `reason:` 说明是命中删除规则还是命中受保护路径。

```console
$ ./scripts/protect.sh test "rm -rf /Users/liuzhaoyang/dsh-fortress-dev/foo"
BLOCKED
reason: 命令的写 / 删 / 移动目标落在 protectedPaths 内

$ ./scripts/protect.sh test "ls /Users/liuzhaoyang/dsh-fortress-dev"
ALLOWED

$ ./scripts/protect.sh test "pnpm remove dsh-bulwark"
BLOCKED
reason: 命中受保护删除规则 protectedRemovalPatterns
```

`test` 用当前 config.json 里的 `protectedPaths` 作为判断输入；如果该文件读不到或
字段非法，就退回插件自己的默认配置。

> 注意：删除规则的关键词来自插件读取的 config.json（`~/dsh-fortress-dev/config.json`）。
> 改名后本机的 config.json 里仍是旧关键词 `dsh-fortress`，所以 `pnpm remove dsh-bulwark`
> 在本机会输出 `ALLOWED`；只有把新名写进 `protectedRemovalPatterns` 后才会像上面那样 `BLOCKED`
> （见 MIGRATION.md 第 4 节）。

### 1.8 help

```console
$ ./scripts/protect.sh --help
protect.sh —— dsh-bulwark 配置管理脚本（v2 脚本路线，无 GUI）
...（子命令、环境变量、示例列表）
```

---

## 2. 修改后如何生效

**DSH 正在运行时**：卡 1 已实现配置热重载——插件用 `fs.watch` 盯着 config.json，
文件改动后会重新读取并整体替换内存里的配置（日志打 `[dsh-bulwark:config] reloaded`）。
脚本采用「临时文件 + rename 覆盖」的写法则更容易被 watch 捕捉到，正常情况下几秒内
自动生效，**不需要重启 DSH**。

**headless 一次性任务**：每次进程启动都会重新 `loadConfig()`，也就是每次任务读到的
都是最新配置，天然是最新的。

**万一热重载没生效**（例如文件系统事件丢失、watch 不可用）：重启 DSH 一定生效；
插件自身也会在 watcher 不可用时打一行
`[dsh-bulwark:config] watcher unavailable, config changes need a restart`。

---

## 3. 配置文件位置

```
~/dsh-fortress-dev/config.json
```

即 `/Users/liuzhaoyang/dsh-fortress-dev/config.json`。这个目录本身就在默认
`protectedPaths` 里，所以配置文件由「保护路径」保护：AI 通过 bash 工具改不动它，
只有人或本脚本能改，形成递归保护。

用环境变量覆盖：

```console
$ FORTRESS_CONFIG=/tmp/fortress-config.json ./scripts/protect.sh show
```

注意：脚本读的是 `FORTRESS_CONFIG`；插件源码里的 `CONFIG_PATH` 常量仍然指向默认
路径，所以 `FORTRESS_CONFIG` 主要影响脚本自己（`test` 子命令会把该文件里的
`protectedPaths` 作为判断输入传给插件）。真要换插件的配置文件位置，得改
`index.ts` 的 `CONFIG_PATH`。

---

## 4. 故障排查

**config.json 坏掉时**：插件不会崩。文件不存在 / 读不动 / JSON 语法错 / 顶层不是
对象 → 全部字段回退内置默认值 `DEFAULT_CONFIG`；只有单个字段缺失或类型不对 →
只有该字段回退默认值；空数组、空字符串视为无效（防止「不小心把保护清空」）。
回退规则与边界见 `CONFIG.md` 第 5 节。

**脚本报 `invalid JSON in ...`**：说明 config.json 语法坏了，插件此刻会用默认值。
修法：拿仓库或文档里的完整示例覆盖它，或直接删掉该文件让插件全用默认值。

**脚本报 `cannot read config file ...`**：路径不存在或无权限。确认
`~/dsh-fortress-dev/config.json` 在不在；用 `FORTRESS_CONFIG` 时确认变量值。

**`remove` 输出 `not protected`**：通常是因为路径写法不同（符号链接、`/var` vs
`/private/var`、相对路径）。脚本已经做了 `realpathSync` 归一化，若还匹配不上，
用 `list` 看看列表里的原始写法。

**`test` 报 `cannot load plugin entry ...`**：说明插件源码路径不对或当前 Node
不支持 `--experimental-strip-types`，脚本没有改任何东西，只是没能加载插件。

---

## 5. 实现约定

- `#!/usr/bin/env bash` + `set -euo pipefail`；任何错误打 stderr 并 exit 非 0。
- JSON 编辑全部用 `node -e` 完成，不使用 `sed` / `awk`。
- 写文件先写同目录临时文件（`.$$.config.json.tmp`）再 `rename` 覆盖。
- `test` 不复制判断逻辑，直接 import 插件源码调用导出函数。
- 除 `add` / `remove` / `set-rules` 外，其余子命令只读，不改文件。
