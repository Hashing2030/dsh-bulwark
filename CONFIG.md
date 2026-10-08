# dsh-fortress 配置说明（卡 6：配置持久化 JSON 版）

## 1. 配置文件路径

```
/Users/liuzhaoyang/dsh-fortress-dev/config.json
```

- 插件在**模块加载阶段**读这个文件（`loadConfig()`），不在 `apply()` 里读。
- **改完配置要重启 DSH 才生效**（配置文件只在启动时读一次，运行中改不会热生效）。
- 这个路径本身就在默认 `protectedPaths`（`/Users/liuzhaoyang/dsh-fortress-dev`）
  之内，所以 **此文件在受保护路径下，AI 无法修改**——改配置只能由人来做，
  这形成「保护配置的文件自己也被保护」的递归保护。
  （注意：`protectedPaths` 一旦被改成不含该目录，这层递归保护就没了。）

## 2. 配置文件结构

```json
{
  "rulesText": "守则文本字符串",
  "protectedPaths": ["/path1", "/path2"],
  "protectedRemovalPatterns": [
    { "keywords": ["dsh plugin", "remove", "dsh-fortress"] },
    { "keywords": ["pnpm", "remove", "dsh-fortress"] }
  ]
}
```

## 3. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `rulesText` | 非空 string | 否 | `[dsh-fortress 守则] 部分工具和路径受保护，不要尝试绕过。` | 注入 `systemPrompt` 的守则文本，段名 `dsh-fortress:rules`，`interpolate: false` |
| `protectedPaths` | 非空 string[] | 否 | `["/Users/liuzhaoyang/dsh-fortress-dev"]` | 只读保护路径：写 / 改 / 删 / 移动都拦，读取（read / grep / glob / cat）放行 |
| `protectedRemovalPatterns` | 非空 `{keywords: string[]}[]` | 否 | 见下方 | 删除语义规则：命令**同时包含某条规则的全部 keywords** 即命中，命中任一规则即拦 |

默认 `protectedRemovalPatterns`（就是卡 4 的 5 条硬编码规则）：

```json
[
  { "keywords": ["dsh plugin", "remove", "dsh-fortress"] },
  { "keywords": ["dsh plugin", "remove", "dsh-plugin-host-template"] },
  { "keywords": ["dsh plugin", "remove", "dsh-plugin-client-template"] },
  { "keywords": ["pnpm", "remove", "dsh-fortress"] },
  { "keywords": ["npm", "uninstall", "dsh-fortress"] }
]
```

匹配方式是**大小写敏感的纯字符串包含**，不做 shell 解析（与卡 4 行为一致）。

## 4. 完整示例

仓库里给了一份可直接用的配置，内容等于默认值，放在配置文件路径上：

```
/Users/liuzhaoyang/dsh-fortress-dev/config.json
```

改这个文件 → 重启 DSH → 新值生效。想验证是否真的读到了配置，最省事的办法是
把 `rulesText` 改成一个显眼字符串，重启后看 systemPrompt 里的守则段是不是变了。

## 5. 回退规则（永不抛错）

原则是「插件必须能加载」，所以任何异常都静默回退到内置默认值
`DEFAULT_CONFIG`（即卡 5 的硬编码内容），不抛错、不阻塞加载：

- 文件不存在 / 读不动（权限、不是文件）→ 全部字段用默认值
- JSON 语法错误 → 全部字段用默认值
- 顶层不是对象（数组、字符串、数字、null）→ 全部字段用默认值
- 单个字段缺失 / 类型不对 → **只有该字段**用默认值，其它字段照常生效
- 字段写成空数组、空字符串，或 `keywords` 为空 → 视为无效，该字段用默认值
  （防止「不小心把保护清空」）
- `protectedRemovalPatterns` 里任意一项格式不对 → 整个字段用默认值

## 6. 已知局限

- 只认绝对路径 token；相对路径不做基准解析。
- bash 重定向 `>` / `>>`、`python -c 'open(...)'` 之类非 rm / mv / cp 的写语义不拦。
- 删除规则仍是关键词匹配，认不出 `dsh plugin remove @scope/dsh-fortress` 这类变体。
- 父目录是指向保护区的符号链接、末级路径又不存在时，`realpathSync` 失败会漏判。
- 配置只在进程启动时读一次，没有热重载。
