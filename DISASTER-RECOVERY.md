# dsh-fortress 逃生与灾难恢复

> 卡 7 交付物。目标：**当 dsh-fortress 把 DSH 弄坏时，能在 1 分钟内把 DSH 救回来。**
>
> 适用场景：本项目（/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress）以开发补丁
> 或 bundle 方式装进 DSH_HOME=/Users/liuzhaoyang/dsh-fortress-dev 的 web / headless profile。

---

## 0. 速查表（先看这里）

| 优先级 | 方式 | 一句话 | 生效范围 | 恢复动作 |
| --- | --- | --- | --- | --- |
| 方式 1（最轻） | 环境变量 | DSH_FORTRESS_DISABLE=1 | 仅本次启动 | 去掉环境变量 |
| 方式 2（中等） | profile patch 层 | 在 cordis.patch.yml 里 disabled: true | 该 profile，持久 | 删掉那几行 |
| 方式 3（最重） | 卸载插件 | dsh plugin --profile web remove dsh-fortress | 该 profile，持久 | 重新 add 回来 |

> **最重要的前提（卡 5 的副作用）**：
> ~/dsh-fortress-dev 默认在 protectedPaths 里，而“卸载插件”的三个关键词组合
> （dsh plugin + remove + dsh-fortress）也在 protectedRemovalPatterns 里。
> **只要 dsh-fortress 还在运行，它的 guard 就会拦下方式 2 和方式 3 的操作。**
> 所以正确顺序永远是：**先做方式 1（或干脆退出 DSH），再动方式 2 / 方式 3。**

### 关键路径速查

| 东西 | 路径 |
| --- | --- |
| 项目根 / bundle patch 源 | /Users/liuzhaoyang/Documents/untitled folder/dsh-fortress/cordis.yml |
| DSH home | /Users/liuzhaoyang/dsh-fortress-dev |
| profile 列表 | ~/dsh-fortress-dev/profiles/ → web、headless |
| 该 profile 的 patch 层 | ~/dsh-fortress-dev/profiles/web/cordis.patch.yml |
| 该 profile 的依赖清单 | ~/dsh-fortress-dev/profiles/web/package.json |
| 插件自身配置（卡 6） | /Users/liuzhaoyang/dsh-fortress-dev/config.json |

---

## 1. 什么情况下需要逃生

按严重程度从高到低：

1. **DSH 根本起不来** —— 启动即崩溃 / 卡死 / Web GUI 一直白屏。
   典型原因：插件抛异常、bundle 加载失败、客户端插件让 __DSH_BOOT__ 解析不了。
2. **guard 误拦正常操作** —— 明明该放行的操作被返回
   blocked: protected path modification 或 blocked: protected tool removal。
   卡 5 的判定是**纯字符串前缀 + 关键词匹配**，以下情况会误伤：
   - 在 ~/dsh-fortress-dev 下做合法改动（例如改 profile 配置、装别的插件）；
   - 命令里恰好同时出现 dsh plugin / remove / dsh-fortress 三个词；
   - config.json 里 protectedPaths 配得太大（例如配成 /Users/liuzhaoyang）。
3. **配置写坏** —— config.json 里 protectedPaths 或被删规则配错，导致大面积误保护。
   （JSON 语法错 / 字段类型错 / 空数组会自动回退默认值，**不会**让插件崩，
   但“语法正确、值离谱”的配置会照常生效。）
4. **守则文本污染对话** —— 系统提示里的 [dsh-fortress 守则] 段落太长或内容不对，干扰正常任务。
5. **插件之间冲突** —— 与其他插件的工具守卫 / systemPrompt section 打架，DSH 启动报冲突。

判断“是不是 dsh-fortress 干的”的最快办法：**用方式 1 禁用后重启，问题消失 = 就是它。**

---

## 2. 逃生方式 1（最轻）：环境变量一键禁用

**原理**：项目根的 cordis.yml 两个条目都带上了表达式

```yaml
disabled: !!js process.env.DSH_FORTRESS_DISABLE === '1'
```

DSH loader 在加载时求值这个表达式，为真就把整个条目禁用（不实例化插件）。
这是**卡 7 专门为逃生铺的路**，改完不用重新 build，重启 DSH 即生效。

### 命令

DSH home 装法（GUI / 正式 profile）：

```bash
DSH_HOME=~/dsh-fortress-dev DSH_FORTRESS_DISABLE=1 dsh web --profile web
```

项目内开发装法（直接吃项目根的 patch）：

```bash
cd "/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress"
DSH_FORTRESS_DISABLE=1 pnpm run dev
# 等价于：DSH_FORTRESS_DISABLE=1 dsh web --patch cordis.yml
```

### 预期结果

- DSH 正常启动，像没装过 dsh-fortress 一样；
- 启动终端里**不会**再出现 [dsh-fortress:guard] 日志；
- 系统提示里**没有** [dsh-fortress 守则] 段落；
- 之前被拦的操作（rm / mv / cp 受保护路径、删插件等）现在可以执行。

### 恢复步骤

把环境变量去掉即可，**不需要改任何文件**：

```bash
DSH_HOME=~/dsh-fortress-dev dsh web --profile web   # 恢复正常加载
```

> 注意：值必须**严格等于** 1。DSH_FORTRESS_DISABLE=0、=yes、=（空）都**不会**禁用。

---

## 3. 逃生方式 2（中等）：改 profile 的 patch 层

**原理**：profile 的组装顺序是
**bundle 层（含 dsh-fortress 自带的 cordis.yml）→ cordis.patch.yml → --patch 覆盖层**，
后一层按 id 覆盖前一层的字段（浅覆盖）。所以在 cordis.patch.yml 里写 disabled: true
会把 bundle 里的 !!js 表达式整个替换掉，效果比方式 1 更“硬”（不受环境变量影响）。

### 命令

编辑 ~/dsh-fortress-dev/profiles/web/cordis.patch.yml，把内容改成：

```yaml
# 逃生通道：临时禁用 dsh-fortress，排查完删除下面两项即可恢复
- id: dsh-plugin-host-template
  disabled: true
- id: dsh-plugin-client-template
  disabled: true
```

（该文件原本是 []，直接整体替换成上面的内容。）

> headless profile 同理：改 ~/dsh-fortress-dev/profiles/headless/cordis.patch.yml。

### 另一种等价写法（方式 2b，改项目源）

如果不想动 ~/dsh-fortress-dev，也可以直接把项目根 cordis.yml 里的两处
disabled: !!js ... 临时改成 disabled: true。
代价是这份文件是 bundle patch 的源，**改完记得改回来**（否则以后所有加载方式都被禁用）。

### 预期结果

- 重启后与方式 1 完全一致（没有 guard 日志、没有守则段落）；
- 区别：**这是持久化的**，不带环境变量重启也依然禁用。

### 恢复步骤

1. 把 cordis.patch.yml 改回 []（或删掉那两项）；
2. 重启 DSH。

### 方式 2 的坑

- **必须先在 guard 关闭的状态下操作**：~/dsh-fortress-dev 在 protectedPaths 里，
  用 DSH 的 write / edit 工具去改这个文件会被 blocked: protected path modification 拦下。
  → **用系统自带的文本编辑器（记事本 / vim / nano）手动改，或者在终端里直接改。**
  手动在 Terminal.app 里执行命令不受 guard 管辖（guard 只拦 DSH 会话内的工具调用）。
- 如果 id 写错（比如写成包名而不是 cordis.yml 里的 id），DSH 会打
  patch: entry ... not found 警告然后跳过，**看起来“改了但没用”**。id 必须是
  dsh-plugin-host-template / dsh-plugin-client-template。

---

## 4. 逃生方式 3（最重）：完全卸载插件

**原理**：把 dsh-fortress 从 profile 的依赖里摘掉。dsh plugin 只是把参数转发给
**profile 目录下的 pnpm**，所以 remove = pnpm remove。

> 这一步之后，profile package.json 里 dependencies 不再有 dsh-fortress，
> 但 dsh.profile.bundles 里可能还留着名字。DSH 加载 bundle 时用的是 try/catch：
> 解析不到的 bundle 会被跳过（记入 skippedBundles 并告警），**不会崩**。
> 想干净一点可以把 bundles 数组里那一项一并删掉。

### 命令

**必须在终端里跑，而且最好先做方式 1 / 2，或先退出 DSH。**
否则 guard 会因为命中 dsh plugin + remove + dsh-fortress 而返回
blocked: protected tool removal。同理 pnpm remove dsh-fortress、
npm uninstall dsh-fortress 也在拦截名单里。

```bash
DSH_HOME=~/dsh-fortress-dev dsh plugin --profile web remove dsh-fortress
```

### 预期结果

- 终端输出 pnpm 的 “- dsh-fortress ...” 移除日志；
- ~/dsh-fortress-dev/profiles/web/package.json 的 dependencies 里不再有 dsh-fortress；
- 重启 DSH 后：没有 guard 日志、没有守则段落，且**任何环境变量都不会把它拉回来**。

### 恢复步骤

**方式 A（推荐，最稳）—— 手工恢复依赖声明再 install：**

1. 编辑 ~/dsh-fortress-dev/profiles/web/package.json，把依赖加回去：

   ```json
   {
     "name": "dsh-profile-web",
     "private": true,
     "dependencies": {
       "dsh-fortress": "link:/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-fortress"
         ]
       }
     }
   }
   ```

   并确认 dsh.profile.bundles 里也有 "dsh-fortress"（卸载不会删它，但如果之前手动删过要补回来）。

2. 安装：

   ```bash
   DSH_HOME=~/dsh-fortress-dev dsh plugin --profile web install
   ```

3. 重启 DSH。

**方式 B（一条命令）—— 直接 add 本地路径：**

```bash
DSH_HOME=~/dsh-fortress-dev dsh plugin --profile web add \
  "link:/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress"
```

> 项目路径里带空格（untitled folder），引号必须加；命令被 dsh plugin 转发给 pnpm 时
> 容易因为空格被拆成多个参数而失败。**失败就直接用方式 A。**

4. 别忘了：如果之前改过 cordis.patch.yml（方式 2），要把它改回 []，
   否则插件装回来了但仍然是禁用状态。

---

## 5. 如何确认逃生成功

逃生之后，依次做下面 3 项检查，3 项都符合才算成功。

### 检查 1：启动终端里没有 guard 日志

**插件加载时**：每次工具调用前，guard 都会往**宿主 stdout** 打一行：

```
[dsh-fortress:guard] bash {"command":"..."}
```

（源码位置：packages/dsh-plugin-host-template/src/index.ts 的
ctx.tools.guard(...) 回调里 console.log('[dsh-fortress:guard]', ...)。）

- 正常加载：启动 DSH 后随便让它跑一个 bash 命令，终端立刻出现这一行；
- **逃生成功：跑多少次工具调用都不会出现这一行。**

> 注意这行打在**跑 dsh web 的那个终端**上，Web GUI 页面里看不到。

### 检查 2：系统提示里没有守则文本

插件注册的 systemPrompt section id 是 dsh-fortress:rules，内容默认是：

```
[dsh-fortress 守则] 部分工具和路径受保护，不要尝试绕过。
```

（内容来自 config.json 的 rulesText，见 CONFIG.md。）

- 在 DSH 会话里直接问模型：**“你的系统提示里有没有以 [dsh-fortress 守则] 开头的段落？原样引用它。”**
- 正常加载：它能原样引出来；
- **逃生成功：它会说没有这一段。**

### 检查 3：无损探测（可选，最直接）

在 DSH 会话里让它执行一条**没有副作用**的受保护路径命令：

```
rm -rf /Users/liuzhaoyang/dsh-fortress-dev/__fortress_probe_does_not_exist__
```

- guard 生效：工具结果直接是 blocked: protected path modification，命令根本没执行；
- **逃生成功：命令真的执行了，返回 No such file or directory**（因为那个路径本来就不存在，
  所以完全没有副作用）。

同一招可以验证“删插件保护”是否解除，但**不要真的拿 pnpm remove dsh-fortress 去探测**——
guard 一旦不在，它会真的把插件卸掉。

---

## 6. 逃生之后：定位问题再回来

逃生的目的不是“永久关掉”，而是“先救活 DSH，再定位”。

### 6.1 快速二分

| 观察 | 结论 |
| --- | --- |
| 禁用后 DSH 能起来 | 问题在 dsh-fortress 本身 |
| 禁用后 DSH 还是起不来 | 不是 dsh-fortress 的问题，去看其他插件 / profile |

### 6.2 优先怀疑卡 6 的配置

config.json 的值配错最容易造成“大面积误保护”。临时把配置文件挪走来验证：

```bash
mv /Users/liuzhaoyang/dsh-fortress-dev/config.json \
   /Users/liuzhaoyang/dsh-fortress-dev/config.json.bak
```

插件读不到文件时会**整份回退默认值**（默认就是“只保护 ~/dsh-fortress-dev”这一档）。
如果挪走后行为变正常，说明是配置值的问题，对照 CONFIG.md 逐字段检查。
验证完挪回来即可。

> 注意：config.json 是在**模块加载时读一次**的，改完必须重启 DSH 才生效。

### 6.3 恢复清单（按顺序）

1. 把 cordis.patch.yml 改回 []；
2. 确认 cordis.yml 的 disabled 表达式是 !!js process.env.DSH_FORTRESS_DISABLE === '1'，
   而不是被人改成了 true；
3. 确认 config.json 回到预期值（或已挪回原位）；
4. 如果做过方式 3，按第 4 节的方式 A 把依赖装回来；
5. 重启 DSH，跑一遍第 5 节的 3 项检查，确认 guard 日志和守则段落都回来了。

---

## 7. 一图流

```
DSH 坏了
  │
  ├─ 只想先救活 ────────► 方式 1：DSH_FORTRESS_DISABLE=1 重启
  │                            │（去掉环境变量即恢复）
  │                            ▼
  ├─ 要持久禁用 ────────► 方式 2：profile/cordis.patch.yml 里 disabled: true
  │                            │（改回 [] 即恢复）
  │                            ▼
  └─ 不想再看到它 ──────► 方式 3：dsh plugin --profile web remove dsh-fortress
                               （改回 package.json + install 即恢复）

顺序铁律：方式 2 / 3 会写 ~/dsh-fortress-dev，而它在 protectedPaths 里
          → 必须先方式 1 或先退出 DSH，否则被 guard 拦下
```
