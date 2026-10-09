import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

//#region src/shell-tokenizer.ts
/**
* dsh-fortress 卡 2：Shell tokenizer（纯函数）
*
* 目标：把一条命令行切成「段」数组，每段是 token 数组。
*   splitCommand('cd /tmp && rm -rf foo')
*   → [['cd', '/tmp'], ['rm', '-rf', 'foo']]
*
* 只做词法切分，不做任何执行、不做任何语义展开：
*   - 不处理变量替换 $VAR / ${VAR}
*   - 不处理命令替换 $(...) / 反引号
*   - 不处理 heredoc <<EOF、进程替换 <(...) / >(...)
*   - 不处理注释 #、不处理通配符 *
* 以上语法一律当普通字符，不报错、不展开。
*
* 硬约束：纯函数、无副作用、不 import 任何 @deepseek-ai/* 与 node:fs、
* 任何输入都不抛错（空串/null/undefined/非字符串 → [[]]）。
*/
/** 空白字符（不含 \n，\n 是段分隔符）。 */
function isBlank(ch) {
	return ch === " " || ch === "	" || ch === "\r" || ch === "\f" || ch === "\v";
}
/**
* 把命令行切成段数组。任何输入都返回 string[][]，最坏返回 [[]]。
*
* 规则：
*   1. 单引号内的内容整体作为一个 token，内部反斜杠不转义；
*   2. 双引号内的内容整体作为一个 token，内部仅 \" 与 \\ 转义；
*   3. 引号外的反斜杠转义下一个字符（\" → "，\\ → \）；
*   4. && || ; | \n 是段分隔符，引号内的分隔符不算；
*   5. 连续空白合并成一个 token 边界。
*/
function splitCommand(command) {
	const text = typeof command === "string" ? command : "";
	const segments = [];
	let tokens = [];
	let token = "";
	let started = false;
	const endToken = () => {
		if (started) {
			tokens.push(token);
			token = "";
			started = false;
		}
	};
	const endSegment = () => {
		endToken();
		segments.push(tokens);
		tokens = [];
	};
	const len = text.length;
	let i = 0;
	while (i < len) {
		const ch = text[i];
		if (ch === "'") {
			started = true;
			i += 1;
			while (i < len && text[i] !== "'") {
				token += text[i];
				i += 1;
			}
			if (i < len) i += 1;
			continue;
		}
		if (ch === "\"") {
			started = true;
			i += 1;
			while (i < len && text[i] !== "\"") if (text[i] === "\\" && (text[i + 1] === "\"" || text[i + 1] === "\\")) {
				token += text[i + 1];
				i += 2;
			} else {
				token += text[i];
				i += 1;
			}
			if (i < len) i += 1;
			continue;
		}
		if (ch === "\\") {
			started = true;
			if (i + 1 < len) {
				token += text[i + 1];
				i += 2;
			} else {
				token += "\\";
				i += 1;
			}
			continue;
		}
		if (ch === "&" && text[i + 1] === "&") {
			endSegment();
			i += 2;
			continue;
		}
		if (ch === "|" && text[i + 1] === "|") {
			endSegment();
			i += 2;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "\n") {
			endSegment();
			i += 1;
			continue;
		}
		if (isBlank(ch)) {
			endToken();
			i += 1;
			continue;
		}
		started = true;
		token += ch;
		i += 1;
	}
	endSegment();
	return segments;
}

//#endregion
//#region src/index.ts
/** 插件名，必须与根目录 cordis.yml 的 loader 条目 name 一致 */
const name = "dsh-plugin-host-template";
/**
* 依赖的宿主服务：
* - systemPrompt / tools 是硬依赖，直接写进 inject，DSH 会等服务就绪后再 apply；
* - webServer 是可选能力——headless profile 里没有这个服务，若写进 inject，插件会
*   一直 pending（waiting for service: webServer），所以改到 apply() 里判空。
*/
const inject = ["systemPrompt", "tools"];
/** 宿主侧 HTTP 路由，与 README「HTTP 接口」章节保持一致 */
const ROUTE_PATH = "/dsh-plugin-host-template-test";
/** 守则段名字：全局唯一，注册与顺序查询都用它 */
const RULES_SECTION = "dsh-bulwark:rules";
/**
* DSH 主目录（卡 7）：DSH 启动时会设置 DSH_HOME；没设时退回 ~/.dsh。
*/
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
/**
* 配置文件路径（卡 6）：位于 <DSH_HOME>/dsh-bulwark/ 下，不再硬编码作者个人路径。
* 该路径在受保护路径内时形成递归保护，AI 改不了。
*/
const CONFIG_PATH = join(DSH_HOME, "dsh-bulwark", "config.json");
/**
* 内置默认配置：内容就是卡 5 之前的硬编码值（protectedPaths 除外）。
*
* 没有 config.json、文件读不动、JSON 语法错、字段缺失或类型不对时都用它，
* 所以「没有配置文件」的行为与卡 5 完全一致。
*
* 卡 7：protectedPaths 默认为空数组——插件无从得知用户想保护什么，
*       用户装完后用 `scripts/protect.sh add <path>` 添加自己的路径。
*/
const DEFAULT_CONFIG = {
	rulesText: "[dsh-bulwark 守则] 部分工具和路径受保护，不要尝试绕过。",
	protectedPaths: [],
	protectedRemovalPatterns: [
		{ keywords: [
			"dsh plugin",
			"remove",
			"dsh-bulwark"
		] },
		{ keywords: [
			"dsh plugin",
			"remove",
			"dsh-plugin-host-template"
		] },
		{ keywords: [
			"dsh plugin",
			"remove",
			"dsh-plugin-client-template"
		] },
		{ keywords: [
			"pnpm",
			"remove",
			"dsh-bulwark"
		] },
		{ keywords: [
			"npm",
			"uninstall",
			"dsh-bulwark"
		] }
	]
};
/**
* 非空字符串数组判断（配置校验用）。
*
* 空数组一律算无效：protectedPaths / protectedRemovalPatterns 写成空数组
* 等于关掉保护，更像误操作，所以退回默认值。
*
* @param raw 来自 JSON 的未知值
* @returns 是合规的非空字符串数组返回 true
*/
function isNonEmptyStringArray(raw) {
	return Array.isArray(raw) && raw.length > 0 && raw.every((item) => typeof item === "string" && item.length > 0);
}
/**
* 删除规则数组校验：每项必须是 { keywords: 非空字符串数组 }。
*
* @param raw 来自 JSON 的未知值
* @returns 合规时返回规则数组，否则 undefined（交给默认值）
*/
function parseRemovalPatterns(raw) {
	if (!Array.isArray(raw) || raw.length === 0) return void 0;
	const patterns = [];
	for (const item of raw) {
		if (item === null || typeof item !== "object") return void 0;
		const keywords = item.keywords;
		if (!isNonEmptyStringArray(keywords)) return void 0;
		patterns.push({ keywords: [...keywords] });
	}
	return patterns;
}
/**
* 读配置文件（卡 6，模块加载阶段执行一次，不放在 apply() 里）。
*
* 全程不抛错：文件不存在、读不动、JSON 语法错误、字段缺失或类型不对，
* 都退回 DEFAULT_CONFIG——插件必须能加载，配置出问题最多让某项回到默认值。
* 字段逐个校验、逐项回退：一个字段写坏了不影响其它字段。
*
* @returns 本次加载生效的配置
*/
/** 读取配置；configPath 仅供测试注入，默认读 CONFIG_PATH */
function loadConfig(configPath = CONFIG_PATH) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		return DEFAULT_CONFIG;
	}
	if (parsed === null || typeof parsed !== "object") return DEFAULT_CONFIG;
	const raw = parsed;
	const rulesText = typeof raw.rulesText === "string" && raw.rulesText.length > 0 ? raw.rulesText : DEFAULT_CONFIG.rulesText;
	return {
		rulesText,
		protectedPaths: isNonEmptyStringArray(raw.protectedPaths) ? [...raw.protectedPaths] : DEFAULT_CONFIG.protectedPaths,
		protectedRemovalPatterns: parseRemovalPatterns(raw.protectedRemovalPatterns) ?? DEFAULT_CONFIG.protectedRemovalPatterns
	};
}
/** 本次加载生效的配置（模块加载时算一次，改完配置要重启 DSH 才生效） */
let CONFIG = loadConfig();
/**
* 从磁盘重新读取配置文件并整体替换 CONFIG（卡 1 配置热重载）。
*
* - 读取失败 / 非法 JSON / 顶层不是对象：保留旧 CONFIG，返回 false（不抛错）
* - 成功：CONFIG 换成新配置，返回 true
*
* apply() 里的 fs.watch 与 e2e 测试都走这条路径。
*
* @param configPath 配置文件路径，默认 CONFIG_PATH
* @returns 是否成功重载
*/
function reloadConfig(configPath = CONFIG_PATH) {
	try {
		const raw = readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			console.log("[dsh-bulwark:config] reload failed, keeping old config: not a JSON object");
			return false;
		}
		CONFIG = loadConfig(configPath);
		return true;
	} catch (error) {
		console.log("[dsh-bulwark:config] reload failed, keeping old config:", error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** 只读返回当前 CONFIG 的浅拷贝（e2e 测试用）。 */
function __getConfigForTest() {
	return { ...CONFIG };
}
/** 用局部补丁替换当前 CONFIG（e2e 测试用，模拟配置变更）。 */
function __setConfigForTest(patch) {
	CONFIG = {
		...CONFIG,
		...patch
	};
}
/**
* 守则文本（卡 6 起来自配置的 rulesText，缺省时用 DEFAULT_CONFIG.rulesText）。
*
* 段上设置 interpolate: false，正文里的 `{{…}}` 等字面花括号不会被当成
* 提示词变量插值。
*/
function getRulesText() {
	return CONFIG.rulesText;
}
/**
* 顺序锚点：systemPrompt 中心顺序表里最靠后的一段（部署人格后缀）。
* 用途见 resolveRulesOrder()。
*/
const ORDER_ANCHOR = "DEPLOYMENT_PERSONA_SUFFIX";
/**
* 解析守则段的 order。
*
* 约定：不硬编码数字，位置一律向 systemPrompt 的中心顺序表要。
* 但 getSectionOrder(name) 只认中心表里登记过的名字，未登记的名字返回
* undefined，而 section() 对非有限 order 会抛 TypeError，直接透传会让插件
* 加载失败。因此分两级：
*
*   1. 先要 'dsh-bulwark:rules' 自己的位置——名字一旦被中心表登记即自动生效；
*   2. 当前它属于外部名字、中心表里没有，于是退回锚点 DEPLOYMENT_PERSONA_SUFFIX
*      （SECTION_ORDERS 的最后一段，由 DSH 自己注册），守则排在宿主说明之后。
*
* @param ctx Cordis 上下文（由 DSH 在运行时注入，本地仅用类型）
* @returns 有限数字，可直接交给 systemPrompt.section()
*/
function resolveRulesOrder(ctx) {
	const own = ctx.systemPrompt.getSectionOrder(RULES_SECTION);
	if (own !== void 0) return own;
	const anchor = ctx.systemPrompt.getSectionOrder(ORDER_ANCHOR);
	if (anchor === void 0) throw new Error(`[dsh-bulwark] systemPrompt 中心顺序表里缺少锚点 ${ORDER_ANCHOR}`);
	return anchor;
}
/** 卡 3 改进 2：命令开头的包装器，跳过它们取后面的真正动词 */
const WRAPPER_COMMANDS = [
	"sudo",
	"command",
	"nohup",
	"env"
];
/**
* 卡 4 改进 0（修补卡 3 缺口）：包装器的「带值选项」名单。
*
* 卡 3 跳过包装器后直接把第一个非包装器 token 当动词，遇到 sudo -u root rm
* 会把 root 当成动词、漏掉真正的 rm。修复办法是：包装器之后凡是以 '-' 开头的
* token 一律继续跳过；但 -u root 这种「选项 + 值」的写法里值不以 '-' 开头，
* 只按前缀跳过就停在了 root 上。因此这里列出每个包装器会吃掉一个后继值的
* 选项，命中时多跳一格（--user=root 这种内联写法值就在 token 里，只需跳一格）。
*
* 对全部包装器生效：command -p ls / env -i rm 这类选项在前的写法同样适用。
*/
const WRAPPER_OPTION_VALUES = {
	sudo: [
		"-u",
		"-g",
		"-p",
		"-C",
		"-h",
		"-r",
		"-t",
		"-U",
		"--user",
		"--group",
		"--prompt",
		"--chdir",
		"--host",
		"--role",
		"--type",
		"--other-user"
	],
	env: [
		"-u",
		"-C",
		"-S",
		"--unset",
		"--chdir",
		"--split-string",
		"--block-signal",
		"--default-signal"
	],
	command: ["-a"],
	nohup: []
};
/** 卡 3 改进 3：支持 -c 内层脚本的 shell 名字 */
const SHELL_COMMANDS = [
	"bash",
	"sh",
	"zsh",
	"dash"
];
/** 卡 3 改进 3：bash -c 递归的最大层数，超过就按普通字符串处理 */
const MAX_SHELL_NESTING = 3;
/** 形如 VAR=value 的环境变量前缀（env 的参数，也是常见的行内赋值） */
function isEnvAssignment(token) {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
/**
* 卡 4 改进 0：某个包装器选项是否要吃掉后面一个 token 作为它的值。
*
* @param wrapper 包装器动词名（sudo / env / command / nohup）
* @param token 包装器之后的选项 token，以 '-' 开头
* @returns 需要多跳一格返回 true
*/
function takesOptionValue(wrapper, token) {
	const options = WRAPPER_OPTION_VALUES[wrapper];
	return options !== void 0 && options.includes(token);
}
/**
* 卡 3 改进 2（卡 4 改进 0 修补）：跳过命令开头的包装器，返回剩下的 token。
*
* 规则：sudo / command / nohup / env 直接跳过；env 后面（以及命令开头）的
* VAR=value 行内赋值也跳过；包装器之后以 '-' 开头的选项继续跳过，带值选项
* （sudo -u root）连值一起跳过；第一个「既不是包装器、不是赋值、也不是包装器
* 选项」的 token 才是动词。全是包装器 / 选项时返回空数组，调用方按未命中处理。
*
* @param tokens 一段命令的 token 列表
* @returns 去掉开头包装器后的 token 列表
*/
function unwrapWrappers(tokens) {
	let index = 0;
	let wrapper;
	while (index < tokens.length) {
		const token = tokens[index];
		if (WRAPPER_COMMANDS.includes(verbName(token))) {
			wrapper = verbName(token);
			index += 1;
			continue;
		}
		if (isEnvAssignment(token)) {
			index += 1;
			continue;
		}
		if (wrapper !== void 0 && token.startsWith("-")) {
			index += takesOptionValue(wrapper, token) ? 2 : 1;
			continue;
		}
		break;
	}
	return tokens.slice(index);
}
/**
* 卡 3：把一条命令行展开成「待判定的 token 段」列表。
*
* 三件事叠在一起：
*   1. 用 splitCommand() 做引号感知的词法切分（改进 1）——引号内的 rm 不再
*      是独立 token，引号内的 && ; | 也不再切段；
*   2. unwrapWrappers() 解开 sudo / env FOO=bar / command / nohup（改进 2）；
*   3. 遇到 bash -c / sh -c 时取 -c 后那个 token 递归解析，最多 3 层（改进 3），
*      超过层数就当普通字符串（shell 动词本身不是写 / 删动词，等于放行）。
*
* 硬约束：tokenizer 抛错时捕获并返回空数组，调用方一律走放行，绝不向上抛。
*
* @param command bash 工具的原始命令字符串
* @param depth 当前递归层数，顶层传 0
* @returns 展开后的 token 段列表（可能为空）
*/
function collectSegments(command, depth) {
	let rawSegments;
	try {
		rawSegments = splitCommand(command);
	} catch {
		return [];
	}
	const result = [];
	for (const raw of rawSegments) {
		const tokens = unwrapWrappers(raw);
		if (tokens.length === 0) continue;
		const verb = verbName(tokens[0]);
		if (SHELL_COMMANDS.includes(verb)) {
			if (depth >= MAX_SHELL_NESTING) continue;
			const flagIndex = tokens.indexOf("-c");
			if (flagIndex === -1 || flagIndex + 1 >= tokens.length) continue;
			for (const inner of collectSegments(tokens[flagIndex + 1], depth + 1)) result.push(inner);
			continue;
		}
		result.push(tokens);
	}
	return result;
}
/**
* 卡 3：单个 token 是否匹配关键词的一个片段。
*
* 匹配刻意收紧到「整个 token 相等」或「以 / 分隔的末段相等」：
*   - 'dsh-bulwark' 命中 token 'dsh-bulwark' 与 '@scope/dsh-bulwark'；
*   - 关键词若只出现在引号包住的整段里（token 内含空格，比如
*     `"pnpm remove dsh-bulwark"`），不算命中——引号内是数据不是命令。
*
* @param token splitCommand 切出来的单个 token
* @param part 关键词按空白拆出来的片段
* @returns 命中返回 true
*/
function tokenMatchesKeywordPart(token, part) {
	if (token === part) return true;
	if (token.includes(" ")) return false;
	return token.endsWith("/" + part);
}
/**
* 关键词（可以含空格，如 'dsh plugin'）是否作为连续 token 子序列出现。
*
* @param tokens 命令展开后的全部 token
* @param keyword 配置里的一条关键词
* @returns 命中返回 true
*/
function tokensHaveKeyword(tokens, keyword) {
	const parts = keyword.split(/\s+/).filter((part) => part.length > 0);
	if (parts.length === 0) return false;
	for (let start = 0; start + parts.length <= tokens.length; start += 1) {
		let matched = true;
		for (let offset = 0; offset < parts.length; offset += 1) if (!tokenMatchesKeywordPart(tokens[start + offset], parts[offset])) {
			matched = false;
			break;
		}
		if (matched) return true;
	}
	return false;
}
/**
* 删除语义识别（卡 4 起，卡 3 接入 tokenizer）：判断一条 bash 命令是否在删除受保护工具。
*
* 卡 3 起不再用 `command.includes(keyword)`，而是先用 collectSegments() 做引号感知的
* 词法切分 / 包装器解包 / bash -c 递归，再在 token 层面匹配。规则（卡 6 起）来自配置的
* protectedRemovalPatterns：一条规则是一组 { keywords: [...] }，命令「同时命中该规则的
* 全部关键词」即命中；命中任一规则就返回 true。默认规则（DEFAULT_CONFIG）：
*   1. 'dsh plugin' + 'remove' + 'dsh-bulwark'
*   2. 'dsh plugin' + 'remove' + 'dsh-plugin-host-template'
*   3. 'dsh plugin' + 'remove' + 'dsh-plugin-client-template'
*   4. 'pnpm' + 'remove' + 'dsh-bulwark'
*   5. 'npm' + 'uninstall' + 'dsh-bulwark'
*
* @param command bash 工具的原始命令字符串
* @returns 命中受保护删除返回 true
*/
function isProtectedRemoval(command) {
	const tokens = collectSegments(command, 0).flat();
	return CONFIG.protectedRemovalPatterns.some((pattern) => pattern.keywords.every((keyword) => tokensHaveKeyword(tokens, keyword)));
}
/**
* 受保护路径（卡 6 起来自配置的 protectedPaths，缺省用 DEFAULT_CONFIG）。
*
* 保护的语义是「只读」：写、改、删、移动都拦，读取一律放行，所以
* read / grep / glob 这类工具完全不出现在下面的判断里。
*/
function getProtectedPaths() {
	return CONFIG.protectedPaths;
}
/**
* 路径归一化：先 realpathSync（解析符号链接、把 /var 收敛成 /private/var），
* 失败就退回 path.resolve（路径不存在、权限不足时 realpathSync 会抛错）。
*
* 统一转小写，因为 APFS 默认大小写不敏感，/Users 和 /users 是同一个目录。
* 整个函数不抛错：任何异常都退化成 resolve 的结果，最坏情况只是匹配不上。
*
* @param raw 原始路径字符串
* @returns 小写的绝对路径
*/
function normalizePath(raw) {
	try {
		return realpathSync(raw).toLowerCase();
	} catch {
		return resolve(raw).toLowerCase();
	}
}
/**
* PROTECTED_PATHS 归一化后的前缀表，模块加载时算一次。
*
* 预先 realpath 是为了绕开 macOS 的 /var → /private/var 这类等价拼法：
* 配置里写的和命令里写的可能指向同一个目录，却不是同一个字符串。
* normalizePath() 自己不抛错，所以放在模块顶层是安全的。
*/
let protectedPrefixCache;
/**
* 当前受保护路径前缀，每次调用重新归一化（带缓存）。
*
* normalizePath() 内含 realpathSync 系统调用；用 CONFIG.protectedPaths 的
* JSON 字符串做 key，配置没变就复用上次结果。
*
* @returns 归一化后的路径前缀列表
*/
function getProtectedPathPrefixes() {
	const key = JSON.stringify(CONFIG.protectedPaths);
	if (protectedPrefixCache !== void 0 && protectedPrefixCache.key === key) return protectedPrefixCache.prefixes;
	const prefixes = CONFIG.protectedPaths.map((path) => normalizePath(path));
	protectedPrefixCache = {
		key,
		prefixes
	};
	return prefixes;
}
/**
* 判断一个已归一化的路径是否落在受保护前缀之内。
*
* 用「相等 或 前缀 + 斜杠」，而不是裸 startsWith：否则
* /Users/.../dsh-fortress-dev-2 这种兄弟目录会被误判成受保护。
*
* @param normalized normalizePath() 的输出
* @returns 命中受保护路径返回 true
*/
function matchesProtectedPrefix(normalized, pathsOverride) {
	const prefixes = pathsOverride ? pathsOverride.map((path) => normalizePath(path)) : getProtectedPathPrefixes();
	return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "/"));
}
/**
* 原始路径字符串是否受保护（写 / 删判断的统一入口）。
*
* @param raw 来自工具参数的未知值，非字符串一律视为不命中
* @param pathsOverride 可选的受保护路径清单（测试注入用）；省略时用 CONFIG.protectedPaths
* @returns 命中受保护路径返回 true
*/
function isProtectedPath(raw, pathsOverride) {
	if (typeof raw !== "string" || raw.length === 0) return false;
	return matchesProtectedPrefix(normalizePath(raw), pathsOverride);
}
/** bash 里与写 / 删 / 移动有关的动词，卡 5 只认这三个 */
const MUTATING_VERBS = [
	"rm",
	"mv",
	"cp"
];
/**
* 取一个 token 的动词名：'/bin/rm' → 'rm'，带引号的 rm 也一样。
*
* @param token 命令切分出来的单个 token
* @returns 去掉引号与目录前缀后的名字
*/
function verbName(token) {
	const unquoted = token.replace(/^['"]|['"]$/g, "");
	const parts = unquoted.split("/");
	return parts[parts.length - 1];
}
/**
* 取一个 token 表示的操作数路径：顺带处理 --flag=value 这种写法。
*
* @param token 命令切分出来的单个 token
* @returns 去引号、去 --flag= 前缀后的字符串
*/
function operandPath(token) {
	const unquoted = token.replace(/^['"]|['"]$/g, "");
	const eq = unquoted.indexOf("=");
	return eq >= 0 ? unquoted.slice(eq + 1) : unquoted;
}
/** 去掉 token 首尾的引号（不动中间的字符） */
function stripQuotes(token) {
	return token.replace(/^['"]|['"]$/g, "");
}
/** 卡 4：只认 of= 目标路径的写入动词（dd） */
const DD_VERB = "dd";
/** 卡 4：任何绝对路径操作数都算写入目标的动词（截断 / 覆盖 / 复制流） */
const OVERWRITE_VERBS = ["truncate", "tee"];
/** 卡 4：内联脚本命令（-c / -e 脚本字符串） */
const SCRIPT_VERBS = [
	"python",
	"python3",
	"node"
];
/**
* 卡 4：python 内联脚本里「以写模式打开绝对路径」的模式。
*
* 只认 open( 的第一个参数是 / 开头的字符串、第二个参数是 w / a / x 三种写模式；
* 读取模式 'r' 与相对路径都不命中（不误伤只读与相对路径脚本）。
*/
const PYTHON_WRITE_OPEN = /open\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*['"]([wax])['"]/gi;
/** 卡 4：node 内联脚本里的写文件调用，只认第一个参数是 / 开头的字符串 */
const NODE_WRITE_CALL = /(?:writeFileSync|appendFileSync)\s*\(\s*['"](\/[^'"]*)['"]/gi;
/**
* 卡 4：从一段命令的 token 里找出 bash 重定向写入的目标路径。
*
* 支持 '> file'、'>> file'、'>file'、'>>file'、'2>file' 这类带 fd 前缀的写法，
* 以及卡 5 补上的 '&>file' / '&>>file'（bash 里等价于 '>file 2>&1'）。
*
* 卡 5 起前缀判定放宽为「空 / 纯数字 / &」三种，其它一律不算重定向；
* 目标若以 & 开头（'2>&1'、'>&2'、'&> &1'）仍然是 fd 复制而不是文件写入，跳过。
*
* 同一个 token 里 '>' 后没有内容时（token 就是 '>' / '>>' / '&>'），目标取下一个
* token，这样 '>file'（无空格）与 '> file' 两种写法都能覆盖。返回值不再限定绝对
* 路径：相对路径交给调用方按 cwd 解析（卡 5 起）。
*
* @param tokens 一段命令的 token 列表（已去包装器）
* @returns 重定向写入的目标路径列表（可能为空，可能含相对路径）
*/
function redirectionTargets(tokens) {
	const targets = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		const gt = token.indexOf(">");
		if (gt === -1) continue;
		if (!/^(\d*|&)$/.test(token.slice(0, gt))) continue;
		let cursor = gt;
		while (cursor < token.length && token[cursor] === ">") cursor += 1;
		let target = token.slice(cursor);
		if (target.length === 0) {
			const next = tokens[i + 1];
			if (next === void 0) continue;
			target = next;
			i += 1;
		}
		const cleaned = stripQuotes(target);
		if (cleaned.length === 0 || cleaned.startsWith("&")) continue;
		targets.push(cleaned);
	}
	return targets;
}
/**
* 卡 5：取相对路径解析的初始 cwd。
*
* 优先用调用方注入的 workspace（apply() 的 guard 回调里从 exec 上拿），
* 其次用 process.cwd()（可能因 cwd 被删而抛错，所以包 try）；两者都拿不到
* 返回 undefined，调用方据此跳过全部相对路径判断。
*
* @param initialCwd 调用方注入的初始 cwd（可选）
* @returns 初始 cwd，或 undefined
*/
function resolveInitialCwd(initialCwd) {
	if (typeof initialCwd === "string" && initialCwd.length > 0) return initialCwd;
	try {
		const cwd = process.cwd();
		return typeof cwd === "string" && cwd.length > 0 ? cwd : void 0;
	} catch {
		return void 0;
	}
}
/**
* 卡 5：把一个路径 token 解析成绝对路径。
*
* 绝对路径原样返回（绝对路径优先，不受 cwd 影响）；相对路径在 cwd 已知时用
* path.resolve() 拼成绝对路径；cwd 未知（起点未知或 cd 失败）时返回 undefined，
* 调用方据此跳过判断。内部不抛错。
*
* @param raw 原始路径字符串（可能带引号）
* @param cwd 当前 cd 跟踪出来的工作目录（可能 undefined）
* @returns 绝对路径，或 undefined
*/
function resolvePathToken(raw, cwd) {
	const cleaned = stripQuotes(raw);
	if (cleaned.length === 0) return void 0;
	if (cleaned.startsWith("/")) return cleaned;
	if (cwd === void 0 || cwd.length === 0) return void 0;
	try {
		return resolve(cwd, cleaned);
	} catch {
		return void 0;
	}
}
/**
* 卡 5：取 cd 的目标操作数：动词之后第一个非选项 token（去引号）。
*
* @param tokens 一段 cd 命令的 token 列表（已去包装器）
* @returns cd 的目标，或 undefined（没有操作数）
*/
function cdTarget(tokens) {
	for (let i = 1; i < tokens.length; i += 1) {
		const candidate = stripQuotes(tokens[i]);
		if (candidate.startsWith("-") && candidate.length > 1) continue;
		return candidate;
	}
	return void 0;
}
/**
* 卡 4：内联脚本（python -c / node -e）里是否在写受保护路径。
*
* 简单字符串扫描，不做 AST：python 认 open( 的写模式（w / a / x）+ 绝对路径，
* node 认 writeFileSync / appendFileSync + 绝对路径第一个参数。不区分大小写；
* 路径不是绝对路径就不命中；扫描不清一律放行。
*
* @param verb 展开后的动词名（python / python3 / node）
* @param text 该段命令的全部 token 拼成的字符串（含脚本体）
* @param pathsOverride 可选的受保护路径清单（测试注入用）
* @returns 命中受保护路径的脚本写入返回 true
*/
function inlineScriptModifiesProtectedPath(verb, text, pathsOverride) {
	const pattern = verb === "node" ? NODE_WRITE_CALL : PYTHON_WRITE_OPEN;
	for (const match of text.matchAll(pattern)) {
		const target = match[1];
		if (target.startsWith("/") && isProtectedPath(target, pathsOverride)) return true;
	}
	return false;
}
/**
* bash 命令级判断（卡 5 起，卡 3 接入 tokenizer，卡 4 扩展写入动词）：
* 命令里是否在对受保护路径做写 / 删 / 移动。
*
* 先用 collectSegments() 展开：
*   1. 按引号感知地切成段（引号内的 && ; | 不算分隔符），并解开
*      sudo / command / nohup / env FOO=bar 包装器、递归展开 bash -c；
*      （卡 4 起包装器后的选项也跳过，sudo -u root rm 能看到 rm）
*   2. 每段先扫重定向写入目标（> / >> / >file，跳过 fd 复制）；
*   3. 再按动词分派：
*      - cp：只有「目标是受保护路径」才拦——cp 受保护路径 → 别处 是读取语义，
*        放行。目标取动词之后最后一个非选项操作数；
*      - rm / mv：该段里任一操作数落在受保护路径内就拦；
*      - dd：只看 of= 的目标（if= 是读取）；
*      - truncate / tee：任一绝对路径操作数落在受保护路径内就拦；
*      - python / node：内联脚本里以写模式打开 / 写文件调用指向受保护路径就拦。
*
* 引号内的 rm（如 `echo "rm /path"`）被 tokenizer 收成一个整体 token，不再被当成动词。
* 卡 5 起支持相对路径：段内跟踪 cd 链得到当前 cwd，相对路径用 path.resolve() 解析后
* 再判定；绝对路径始终优先判定，不受 cwd 影响。cd 目标不存在（fs.existsSync 为假）
* 视为 cd 失败，之后所有相对路径判断跳过，直到下一次 cd 成功；初始 cwd 拿不到时
* （既没有注入 workspace 也拿不到 process.cwd()）同样跳过相对路径判断。
*
* 守卫体内不抛错：tokenizer 抛错时 collectSegments() 返回空列表，直接放行。
*
* @param command bash 工具的原始命令字符串
* @param pathsOverride 可选的受保护路径清单（测试注入用）；省略时用 CONFIG.protectedPaths
* @param initialCwd 可选的初始工作目录（apply() 的 guard 从 exec.workspace 注入）
* @returns 命中受保护路径的写 / 删返回 true
*/
function isProtectedPathModification(command, pathsOverride, initialCwd) {
	const segments = collectSegments(command, 0);
	let cwd = resolveInitialCwd(initialCwd);
	if (cwd === void 0) console.log("[dsh-bulwark:guard] cwd unavailable, relative path checks skipped");
	for (const tokens of segments) {
		for (const target of redirectionTargets(tokens)) {
			const absolute = resolvePathToken(target, cwd);
			if (absolute !== void 0 && isProtectedPath(absolute, pathsOverride)) return true;
		}
		const verb = verbName(tokens[0]);
		if (verb === "cd") {
			const target = cdTarget(tokens);
			const absolute = target === void 0 ? void 0 : resolvePathToken(target, cwd);
			cwd = absolute !== void 0 && existsSync(absolute) ? absolute : void 0;
			continue;
		}
		const operands = tokens.slice(1);
		if (verb === "cp") {
			for (let i = operands.length - 1; i >= 0; i -= 1) {
				const candidate = operandPath(operands[i]);
				if (candidate.startsWith("-")) continue;
				const absolute = resolvePathToken(candidate, cwd);
				if (absolute !== void 0 && isProtectedPath(absolute, pathsOverride)) return true;
				break;
			}
			continue;
		}
		if (MUTATING_VERBS.includes(verb)) {
			for (const token of operands) {
				const candidate = operandPath(token);
				const absolute = resolvePathToken(candidate, cwd);
				if (absolute !== void 0 && isProtectedPath(absolute, pathsOverride)) return true;
			}
			continue;
		}
		if (verb === DD_VERB) {
			for (const token of operands) {
				const raw = stripQuotes(token);
				if (!raw.startsWith("of=")) continue;
				const absolute = resolvePathToken(raw.slice(3), cwd);
				if (absolute !== void 0 && isProtectedPath(absolute, pathsOverride)) return true;
			}
			continue;
		}
		if (OVERWRITE_VERBS.includes(verb)) {
			for (const token of operands) {
				const candidate = operandPath(token);
				const absolute = resolvePathToken(candidate, cwd);
				if (absolute !== void 0 && isProtectedPath(absolute, pathsOverride)) return true;
			}
			continue;
		}
		if (SCRIPT_VERBS.includes(verb)) {
			if (inlineScriptModifiesProtectedPath(verb, tokens.join(" "), pathsOverride)) return true;
			continue;
		}
	}
	return false;
}
/**
* 插件主体：注册宿主侧 HTTP 接口 + 注入 dsh-bulwark 守则段 + 挂工具守卫。
*
* @param ctx Cordis 上下文（由 DSH 在运行时注入，本地仅用类型）
*/
function apply(ctx) {
	const webServer = ctx.get("webServer");
	if (webServer !== void 0) webServer.register({
		kind: "exact",
		path: ROUTE_PATH,
		handler: (_req, res) => {
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ serverTime: Date.now() }));
		}
	});
	ctx.effect(() => ctx.systemPrompt.section({
		name: RULES_SECTION,
		order: resolveRulesOrder(ctx),
		get text() {
			return getRulesText();
		},
		interpolate: false
	}), "dsh-bulwark:rules section");
	ctx.effect(() => ctx.tools.guard((exec) => {
		console.log("[dsh-bulwark:guard]", exec?.name, exec?.arguments);
		if (exec?.name === "bash") {
			const command = exec?.arguments?.command;
			console.log("[dsh-bulwark:guard] bash command:", command);
			if (typeof command === "string") {
				if (isProtectedRemoval(command)) return "blocked: protected tool removal";
				const workspace = exec?.workspace;
				if (isProtectedPathModification(command, void 0, typeof workspace === "string" ? workspace : void 0)) return "blocked: protected path modification";
			}
		}
		if (exec?.name === "write" || exec?.name === "edit" || exec?.name === "str_replace_editor") {
			const args = exec?.arguments;
			if (args !== null && typeof args === "object") {
				const candidate = args.path ?? args.file_path;
				if (isProtectedPath(candidate)) return "blocked: protected path modification";
			}
		}
		return void 0;
	}), "dsh-bulwark:tools guard");
	ctx.effect(() => {
		let lastMtime = 0;
		let watcher;
		const configDir = dirname(CONFIG_PATH);
		try {
			mkdirSync(configDir, { recursive: true });
		} catch (error) {
			console.log("[dsh-bulwark:config] cannot create config dir", configDir, error.message);
			return () => {};
		}
		try {
			lastMtime = statSync(CONFIG_PATH).mtimeMs;
		} catch {}
		try {
			watcher = watch(CONFIG_PATH, (eventType) => {
				if (eventType !== "change") return;
				try {
					const stat = statSync(CONFIG_PATH);
					const mtime = stat.mtimeMs;
					if (mtime === lastMtime) return;
					lastMtime = mtime;
					if (reloadConfig()) console.log("[dsh-bulwark:config] reloaded");
				} catch (error) {
					console.log("[dsh-bulwark:config] reload failed, keeping old config:", error instanceof Error ? error.message : String(error));
				}
			});
			watcher.unref();
		} catch (error) {
			console.log("[dsh-bulwark:config] watcher unavailable, config changes need a restart:", error instanceof Error ? error.message : String(error));
		}
		return () => {
			if (watcher !== void 0) watcher.close();
		};
	}, "dsh-bulwark:config watcher");
	return void 0;
}

//#endregion
export { CONFIG_PATH, DEFAULT_CONFIG, __getConfigForTest, __setConfigForTest, apply, getProtectedPathPrefixes, getProtectedPaths, getRulesText, inject, isProtectedPath, isProtectedPathModification, isProtectedRemoval, loadConfig, name, reloadConfig };