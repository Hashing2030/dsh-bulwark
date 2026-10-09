# 卡 6 探测报告：DSH 0.2.0-rc.2 的 settings API 实际形态

- 探测时间：2026-10-09 20:05:33 → 20:06:12（Asia/Shanghai），**总耗时 39 秒**
- DSH 版本：0.2.0-rc.2（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-settings/package.json`）
- 探测过程中未修改任何项目文件；本报告是本轮唯一新增文件

---

## 一、三条探测命令的完整输出

### 探测 1：`dsh --profile web --dump-config`

命令：

```
cd "/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress"
dsh --profile web --dump-config
```

结果：`EXIT=0`，输出共 **1263 行**，以 `# == <bundle 名>` 分块，共 **105 个插件条目**（`grep -c "  - id: "`）。输出开头：

```yaml
# == @deepseek-ai/dsh-base
- id: tool-plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager/tools'
  disabled: true
- id: plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager'
  disabled: !!js '!ctx.get(''profileContext'')'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: !!js '!ctx.get(''profileContext'')'
  config:
    root: []
- id: llm
  name: '@deepseek-ai/dsh-llm'
- id: deepseek-llm-api-extensions
  name: '@deepseek-ai/dsh-deepseek-llm-api-extensions'
- id: session
  name: '@deepseek-ai/dsh-session'
```

与 settings 相关的条目（`grep -n -i -E "settings|config-editor"` 的命中，共 34 行，节选）：

```yaml
59:  name: '@deepseek-ai/dsh-config-editor'
60:  disabled: !!js '!ctx.get(''profileContext'')'
61:- id: settings
62:  name: '@deepseek-ai/dsh-settings'
63:  disabled: !!js '!ctx.get(''profileContext'')'
64:- id: authorization
65:  name: '@deepseek-ai/dsh-authorization'
66:- id: deepseek-account
67:  name: '@deepseek-ai/dsh-deepseek-account-platform'
...
543:- id: ui-sidebar-files
544:  name: '@deepseek-ai/dsh-client-ui-sidebar-files'
545:- id: ui-settings
546:  name: '@deepseek-ai/dsh-client-ui-settings'
547:# == @deepseek-ai/dsh-web-app, patched by /Users/liuzhaoyang/.dsh/profiles/web/cordis.patch.yml
548:- id: ui-settings-general
549:  name: '@deepseek-ai/dsh-client-ui-settings-general'
550:  config:
551:    welcomeNoticeVersion: 2026-09-28.1
...
612:  name: '@deepseek-ai/dsh-client-ui-settings-subagent'
613:- id: ui-settings-web-search
614:  name: '@deepseek-ai/dsh-client-ui-settings-web-search'
```

补充（同一命令输出内，用于判断 GUI 形态）：

```yaml
755:              modelSelectionSettings: true
937:              modelSelectionSettings: true
1201:              modelSelectionSettings: true
```

**关键观察**：

1. 服务端条目 `- id: settings / name: '@deepseek-ai/dsh-settings'` 在 web profile **启用**（`disabled` 条件是 `!ctx.get('profileContext')`，web profile 有 profileContext ⇒ 不禁用），依赖 `config-editor`。
2. 客户端条目是一组 `ui-settings*` 插件：`ui-settings`、`ui-settings-general`、`ui-settings-agent-loop`、`ui-settings-models`、`ui-settings-shell`、`ui-settings-subagent`、`ui-settings-web-search`、`ui-settings-session-log`、`ui-settings-account`、`ui-settings-plugins`、`ui-settings-plugin-inventory`。**设置页是「每插件一个 page」的形态**，不是单一全局表单。
3. 各插件条目直接挂在 `config:` 下（如 `ui-settings-general.config.welcomeNoticeVersion`），说明**设置项就是插件 Config 的字段**。
4. `dsh-fortress` 在本 profile 的 dump 中**完全不存在**（`grep -i fortress` 无命中），即当前未以条目形式装进 web profile。

### 探测 2：从 app.asar 抽取 `@deepseek-ai/dsh-settings` 源码，只读导出

抽取到的文件清单（`asar list`）：

```
/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js
/dsh/node_modules/@deepseek-ai/dsh-settings/lib/types/index.js
/dsh/node_modules/@deepseek-ai/dsh-settings/lib/types/redact.js
/dsh/node_modules/@deepseek-ai/dsh-settings/lib/types/schema.js
/dsh/node_modules/@deepseek-ai/dsh-settings/lib/types/types.js
/dsh/node_modules/@deepseek-ai/dsh-settings/package.json
```

`lib/index.js` 最后一行（导出全集，共 544 行）：

```js
export { SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets };
```

对 `installSection|register|export |exports\.` 的检索结果只有 3 处，均为注释或上面那行导出：

```
367:	* @returns Disposer; register it with the calling plugin's effects.
368:	* @throws If this instance already has a registered policy.
544:export { SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets };
```

结论（直接回答卡里的问题）：

- **`installSection`：不存在。** 整个包（含 lib/types/*）没有该标识符。
- **`register`：不存在**（作为 settings API）。仅有的 "register" 是文档注释里描述「把 disposer 登记到调用方 effects」的措辞。
- **没有按 namespace key 的 `settings.plugin.item` slot API。**

实际形态是一个 **Cordis Service**（`var SettingsForms = class extends Service`）：

```js
var SettingsForms = class extends Service {
	ownerContext;
	static inject = ["configEditor", "profileContext"];
	...
	constructor(ownerContext) {
		super(ownerContext, "settings");   // 服务名 = "settings" ⇒ ctx.settings
		...
	}
```

服务名是 `"settings"`，即插件侧通过 `ctx.settings` 访问（与 `types/deepseek-ai.d.ts` 里 `tools` / `systemPrompt` 同一套写法）。公开方法（含 JSDoc 首句）：

| 方法 | 签名 | 作用（源码注释） |
| --- | --- | --- |
| `configure(presentation, owner = this.ctx.fiber)` | 返回 disposer | 「Register the calling plugin instance's **page policy** without changing its Config」，参数 `presentation` 即自动页策略，`auto` 默认 true；同一 fiber 重复注册抛 `Settings presentation is already configured for this plugin instance` |
| `describe(options)` | 返回 descriptor 数组 | 「Read active plugin schemas and their live values」，按 `ns`（= profile entry id）给出 `{ autoGenerate, ns, schema, revision, applies: "live", value, base, user, secrets? }` |
| `update(ns, patch, expectedRevision)` | Promise | 「Merge editable fields into an entry's config」 |
| `replace(ns, section, expectedRevision)` | Promise | 「Reset all live fields, then set the supplied fields」 |
| `mutate(ns, ops, expectedRevision)` | Promise | 「Apply field edits without restating redacted secrets」 |
| `invalidate()` / `prepareDocument()` | — | 触发重算 / 定位 profile patch 文件 |
| `writable` / `documentPath` | getter | 是否可写 / 当前 profile patch 路径 |

**关键机制（决定「守则文本 / 受保护路径」能不能进 GUI）**——`describe()` 对每个 entry 调 `volatileForm(schema)`，而 `lib/types/schema.js` 里：

```js
/** Select fields whose nearest volatile ancestor makes them editable without remounting.
* @param schema The plugin's Config schema.
* @returns A plain form schema, or undefined when no field is live.
*/
function volatileForm(schema) {
	if (schema.meta.volatile) return plainSchema(schema);
	if (schema.type === "object") {
		const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
			const field = volatileForm(child);
			return field === void 0 ? [] : [[key, field]];
		}));
		return Object.keys(dict).length === 0 ? void 0 : z.object(dict);
	}
}
```

`describe()` 中该字段为 `undefined` 时直接跳过（`if (form === void 0) return []`），`write()` 亦会抛 `Plugin entry "<ns>" has no volatile fields`。即：**只有被标成 volatile 的 Config 字段才会出现在设置页，并能热更新。**

`volatile` 标记来自 `@deepseek-ai/schemastery`（asar 内 `node_modules/@deepseek-ai/schemastery/lib/types/index.js`）：

```js
253: Schema.prototype.volatile = function volatile() {
254:     if (this.meta.volatile)
255:         throw new TypeError('volatile schema is already wrapped');
256:     return this.extra('volatile', true);
259: const checkedVolatile = Symbol('checked-volatile-schema');
266:     if (schema.meta?.volatile && blocked) {
267:         throw new ValidationError('volatile fields require a fixed object path without an enclosing volatile field', { path });
```

即写法是 `Schema.object({ ... }).volatile()`，且**一个 volatile 字段内部不能再嵌 volatile 字段**。

`package.json`（版本与依赖）：

```json
{
  "version": "0.2.0-rc.2",
  "dependencies": {
    "yaml": "^2.8.1",
    "@deepseek-ai/dsh-util-values": "0.2.0-rc.2",
    "@deepseek-ai/cosmokit": "~1.8.5",
    "@deepseek-ai/cordis-plugin-loader": "~1.0.5",
    "@deepseek-ai/dsh-config-editor": "0.2.0-rc.2"
  }
}
```

### 探测 3：`types/deepseek-ai.d.ts`

文件：`/Users/liuzhaoyang/Documents/untitled folder/dsh-fortress/types/deepseek-ai.d.ts`（76 行 / 2646 字节，最后修改 10-08 20:56）。

**没有任何 settings 相关声明。** 现有全部声明只有：

| 声明 | 内容 |
| --- | --- |
| `declare module '@deepseek-ai/cordis'` → `interface Context` | `webServer?: { register(route: {kind:'exact'\|'prefix', path, handler}) }`；`get<K>(name): undefined \| this[K]`；`effect(callback, label?)`；`systemPrompt: { section(...), getSectionOrder(name) }`；`tools: { guard(guard): () => void }` |
| `declare module '@deepseek-ai/dsh-host-webserver'` | 空模块声明 |
| `declare module '@deepseek-ai/dsh-system-prompt'` | 空模块声明 |
| `declare module '@deepseek-ai/dsh-client-runtime/client'` | `interface ClientContext { slots: any }` |

也就是说：`ctx.settings` 目前**没有本地类型**，若要走 settings 路线，需要往这份模拟 .d.ts 里补一条（按现有 `tools` / `systemPrompt` 的风格），否则本地 tsc 过不了。

---

## 二、建议用哪个 API

**建议：走 `Config` schema + `ctx.settings.configure()` 的「声明式」路线，而不是任何「注册 section」的老 API。**

理由（全部有上面探测输出支撑）：

1. `installSection` 与 `register` 在 0.2.0-rc.2 中**均不存在**，卡里列的历史 API 在这个版本已全部不可用；GUI 的形态已经改成「插件 Config 字段 → 自动生成 page」。
2. 设置项的事实来源就是插件条目的 `config:`（dump 里 `ui-settings-general.config.welcomeNoticeVersion` 是直接证据），`SettingsForms.describe()` 遍历 `configEditor.configuration()` 按 entry 投影，没有第二条写入通道。
3. `configure(presentation)` 只控制「页策略（自动页与否）」，**不提供自定义控件/自定义区块**；它不能承载 rulesText 这种多行文本或 protectedPaths 这种列表的自由编辑，除非这些字段本身在 Config schema 里。

因此落地形态应为：

- 在 `@deepseek-ai/dsh-fortress` 里声明带 `.volatile()` 的 `Config`（`rulesText` 多行文本、`protectedPaths` 字符串列表），使它们出现在设置页的 fortress page 并支持热改；
- 用 `ctx.settings.configure({ auto: true })` 登记页策略（可选，仅影响是否自动出页）；
- 插件从 `config` 读 `rulesText` / `protectedPaths`，替换现在写死在代码里的默认值；
- 需要在 `types/deepseek-ai.d.ts` 补 `settings` 的模拟类型（只加类型声明，不 import 运行时包）。
- 另需一个前置条件：当前 web profile 的 dump 里**没有 fortress 条目**，GUI 可见的前提是插件以带 `config` 的条目装进 `~/.dsh/profiles/web/cordis.patch.yml`（或等价的 profile 配置）。

## 三、风险与不确定点（需在你审批后进一步确认，本轮未展开）

1. **volatile 约束**：`Schema.prototype.volatile` 抛 `volatile schema is already wrapped`，且 `volatile fields require a fixed object path without an enclosing volatile field`。把整个 Config 标 volatile（顶层一个节点）与给每个字段分别标 volatile（对象下多个 live 字段）要选一种，前者更简单。
2. **写入语义**：`update` 是 merge、`replace` 是 reset+set；`describe` 的 `value/base/user` 三层（含 profile patch 的分层）需要在实现时确认哪一层是「用户编辑值」。
3. **`applies: "live"`**：descriptor 固定报 `live`，意味着编辑不重挂插件、直接热更新配置；具体热更新链路（`app-boot/config-reload` → 守卫是否立即换新规则）本轮未验证——按硬约束没有跑 headless / 没有做实验。
4. **client 侧未探测**：`@deepseek-ai/dsh-client-ui-settings` 及 `dsh-api-settings-controller` 的内部实现未读（超出卡里限定的探测范围）。若声明式路线生成的控件不够用（例如需要多行文本域、路径列表编辑器），需要在下一步再探测 client 侧能渲染哪些 schema 类型。

## 四、是否需要降级

**不需要立即降级到脚本**，但存在明确前置条件（上面第三节第 1、4 点 + 第二节末的 profile 安装条件）。如果后续确认「多行文本 + 路径列表」这两类 schema 在设置页渲染效果不可接受，或 volatile 热更新不生效，再降级为 CLI/脚本子命令管理 rulesText 与 protectedPaths。

当前状态：**探测完成，等待审阅本报告后再决定实现 GUI 还是降级。**
