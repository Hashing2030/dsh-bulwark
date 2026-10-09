# dsh-bulwark 迁移指南（从 dsh-fortress 改名）

> 卡 8 交付物。适用版本：0.1.0（改名后第一个版本）。
> 改名前后**代码逻辑、配置文件、受保护路径、子包名全都没变**，变的只有「包名 / 项目名」
> 以及由项目名派生的运行时标识（日志前缀、systemPrompt 段名、默认守则文本、默认删除规则关键词）。

---

## 1. 为什么要改名

**npm 上的 `dsh-fortress` 已被他人占用**，我们无法用这个名字发布。

所以本项目正式名改为 **`dsh-bulwark`**：

- `bulwark` = 堡垒 / 屏障，语义与原来的 `fortress` 一致；
- 直接 `npm publish` 不会再撞名。

**开发目录名没有改**，仍然是：

```
/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress
```

（改目录名会让 DSH App profile 里已经写死的 `link:` 路径断掉，所以保持原样。）

---

## 2. 旧名 → 新名对应关系

| 项目 | 旧 | 新 | 说明 |
|---|---|---|---|
| npm 包名 | `dsh-fortress` | **`dsh-bulwark`** | 根包 `package.json` 的 `name` |
| 项目 / 文档自称 | dsh-fortress | **dsh-bulwark** | README / CONFIG / DISASTER-RECOVERY / TESTING / SCRIPT-USAGE |
| 日志前缀 | `[dsh-fortress:guard]` / `[dsh-fortress:config]` | `[dsh-bulwark:guard]` / `[dsh-bulwark:config]` | 只影响终端日志文本 |
| systemPrompt 段名 | `dsh-fortress:rules` | `dsh-bulwark:rules` | 内部 section id |
| 内置默认守则文本 | `[dsh-fortress 守则] …` | `[dsh-bulwark 守则] …` | **运行时以 config.json 为准**，见第 4 节 |
| 内置默认删除规则关键词 | `dsh-fortress` | `dsh-bulwark` | 同上，运行时以 config.json 为准 |
| **项目目录名** | `…/dsh-fortress` | **不变** | 保持 `dsh-fortress` |
| **数据目录** | `~/dsh-fortress-dev` | **不变** | 用户隔离环境，正在用，动了 App 就断 |
| **子包名** | `dsh-plugin-host-template` / `dsh-plugin-client-template` | **不变** | cordis loader 按包名引用，改名会加载失败 |
| `CONFIG_PATH` 常量 | `~/dsh-fortress-dev/config.json` | **不变** | 路径，不是项目名 |
| `config.json` 内容 | — | **不变** | 本次不动配置文件 |

---

## 3. 用户需要在 DSH App 里手动做的步骤

改名后，App 里旧的 `dsh-fortress` 条目会失效（profile 里记的包名和现在 `package.json`
里的包名对不上，启动时该 bundle 会被跳过）。请按顺序操作：

1. 打开 DSH App，进入**插件页**；
2. 找到 **`dsh-fortress`**，点**卸载**；
3. 点 **“+ 添加插件”**，输入：

   ```
   /Users/liuzhaoyang/Documents/untitled folder/dsh-fortress
   ```

4. 点**安装**（此时读到的 `package.json` 已经是 `dsh-bulwark`）；
5. **两个子包不用动** —— `dsh-plugin-host-template` / `dsh-plugin-client-template`
   名字没变、`link:` 路径也没变，卸载根包不会影响它们；
6. **重启 App**，然后验证守则还在。在会话里问 AI：

   > 你的系统提示里有没有 `[dsh-fortress 守则]` 或 `[dsh-bulwark 守则]` 开头的段落？原样引用它。

   - 引用了 **`[dsh-fortress 守则]`** → 正常，说明守则生效了，只是守则文本还是旧名（原因见第 4 节）；
   - 什么都没有 → 说明插件没装上，回到第 2 步重来。

### 想让守则文本也变成 dsh-bulwark

守则文本存在 `config.json` 里，本次**没有动配置文件**，所以它默认还是旧文案。执行：

```bash
./scripts/protect.sh set-rules "[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。"
```

（脚本路径相对项目根；这条命令只改 `rulesText`，`protectedPaths` / 删除规则不受影响。）

---

## 4. 旧插件还在跑时的注意事项

1. **改名前，旧插件是好的；改名后，旧条目会失效。**
   在 App 里完成第 3 节的「卸载 → 重新添加」之前，守则段和工具守卫**不会**生效
   （profile 里的 bundle 名字对不上会被跳过）。所以**最好一次做完**，中间不要重启 App 去干活。

2. **不要删项目目录、不要改目录名。**
   profile 里的 `link:` 指向的就是 `/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress`。
   目录改名或移动 → 卸载重装也救不回来，得手工改 profile 的 `package.json`。

3. **`config.json` 是运行时事实来源，本次没改。**
   它现在的 `protectedRemovalPatterns` 里仍然是旧关键词：

   ```json
   { "keywords": ["pnpm", "remove", "dsh-fortress"] },
   { "keywords": ["npm", "uninstall", "dsh-fortress"] }
   ```

   后果有两条，务必知道：

   - ✅ **旧名字仍然受保护**：`pnpm remove dsh-fortress`、`npm uninstall dsh-fortress`
     依然会被拦（内置默认值只在不读 config.json 时才用得上）；
   - ⚠️ **新名字暂时不受删除保护**：`dsh plugin --profile web remove dsh-bulwark`
     现在**不会被拦**，因为没有任何一条规则的关键词是 `dsh-bulwark`。

   想补上，手工编辑 `~/dsh-fortress-dev/config.json`，在 `protectedRemovalPatterns`
   里加一条（**改配置文件属于改用户环境，改完重启或让 config watcher 重载**）：

   ```json
   { "keywords": ["dsh plugin", "remove", "dsh-bulwark"] },
   { "keywords": ["pnpm", "remove", "dsh-bulwark"] },
   { "keywords": ["npm", "uninstall", "dsh-bulwark"] }
   ```

   `scripts/protect.sh` 目前只提供 `add` / `remove` / `list` / `rules` / `set-rules` /
   `show` / `test`，没有改删除规则的子命令，所以这一段只能手改 JSON
   （改完可以用 `./scripts/protect.sh test "pnpm remove dsh-bulwark"` 验证）。

4. **逃生通道没变。** `DSH_FORTRESS_DISABLE=1` 环境变量名、`~/dsh-fortress-dev`
   路径、卸载/禁用流程全部照旧，见 `DISASTER-RECOVERY.md`。

5. **测试用例的第 5～10 条仍按旧名断言。**
   `tests/e2e.test.ts` 里 `pnpm remove dsh-fortress` 这类命令**刻意没有改**
   （卡 8 硬约束：不动断言期望值），它们靠本机 `~/dsh-fortress-dev/config.json`
   里的旧规则通过。所以：

   - 在本机跑 `pnpm test:e2e` 是 **71/71 通过**；
   - 换一台**没有**这份 config.json 的机器跑，第 7、8 条会失败——那是环境依赖，不是这次改名引入的 bug。

6. **发布相关。** 根包已去掉 `"private": true`、补上 `license` / `main` / `exports` /
   `files` / `prepare`，`pnpm pack --dry-run` 产物是 `dsh-bulwark-0.1.0.tgz`，
   内含 `cordis.patch.yml`、`cordis.yml`、两个子包的 `dist/` 与 `cordis.patch.yml`。
   发布由用户手动执行（本卡不跑 `npm publish`）。

---

## 5. 一分钟自检清单

```bash
# 1. 包名
node -e "console.log(require('./package.json').name)"      # -> dsh-bulwark

# 2. 只有数据目录还带旧名
grep -rn "dsh-fortress" src/index.ts
# -> 只剩 ~/dsh-fortress-dev 相关路径

# 3. 测试
pnpm test:e2e                                              # -> 71/71

# 4. 打包体检
npx dsh-plugin-lint .                                      # -> PASS
pnpm build && pnpm pack --dry-run                          # -> tarball 含 dist/ 与 cordis.patch.yml
```
