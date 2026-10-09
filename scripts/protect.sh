#!/usr/bin/env bash
#
# protect.sh —— dsh-bulwark 配置管理脚本（v2：脚本路线，不提供 GUI）
#
# 只做一件事：安全地读写 dsh-bulwark 的 config.json
#   - add / remove / list  维护 protectedPaths
#   - rules / set-rules    读写 rulesText
#   - show                 打印完整配置
#   - test <command>       调用插件的判断函数，看一条命令会不会被拦
#
# 设计约束：
#   - JSON 编辑一律用 node -e，不用 sed / awk（避免破坏 JSON 结构）
#   - 写文件先写同目录临时文件，再 rename 覆盖（避免半写入状态）
#   - 任何错误打 stderr 并 exit 非 0
#   - test 直接动态 import 插件源码，不复制一份判断逻辑
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_ENTRY="${REPO_ROOT}/packages/dsh-plugin-host-template/src/index.ts"

# 默认配置文件；FORTRESS_CONFIG 可覆盖
CONFIG="${FORTRESS_CONFIG:-${HOME}/dsh-fortress-dev/config.json}"

die() {
  printf 'protect.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
protect.sh —— dsh-bulwark 配置管理脚本（v2 脚本路线，无 GUI）

用法:
  protect.sh <子命令> [参数]

子命令:
  add <path>        把一个路径加入 protectedPaths（归一化后去重）
  remove <path>     从 protectedPaths 移除一个路径（归一化后匹配）
  list              逐行打印 protectedPaths
  rules             打印当前 rulesText
  set-rules <text>  替换 rulesText（多个参数按空格拼接）
  show              打印完整 config.json（格式化 JSON）
  test <command>    调用插件判断一条命令会被拦（BLOCKED）还是放行（ALLOWED）
  help, --help      显示本帮助

环境变量:
  FORTRESS_CONFIG   配置文件路径，默认 ~/dsh-fortress-dev/config.json

示例:
  ./scripts/protect.sh add /tmp/foo
  ./scripts/protect.sh remove /tmp/foo
  ./scripts/protect.sh set-rules "[dsh-bulwark 守则] 新的守则内容"
  ./scripts/protect.sh test "rm -rf /Users/liuzhaoyang/dsh-fortress-dev/foo"
EOF
}

# 配置读写：全部在一个 node 进程里按 FORTRESS_CMD 分派
run_edit() {
  FORTRESS_CONFIG="${CONFIG}" node --input-type=module -e "$(cat <<'JS'
import { readFileSync, realpathSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

const configPath = process.env.FORTRESS_CONFIG
const cmd = process.env.FORTRESS_CMD

function fail(message) {
  console.error(`protect.sh: ${message}`)
  process.exit(1)
}

// 与插件内部 normalizePath 一致的归一化策略：先 realpathSync，失败回退 path.resolve
function normalizePath(raw) {
  try {
    return realpathSync(raw)
  } catch {
    return resolve(raw)
  }
}

function readConfig() {
  let text
  try {
    text = readFileSync(configPath, 'utf8')
  } catch (error) {
    fail(`cannot read config file ${configPath}: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    fail(`invalid JSON in ${configPath}: ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`config root must be a JSON object: ${configPath}`)
  }
  return parsed
}

// 先写同目录临时文件，再 rename 覆盖：不会留下半写入的 config.json
function atomicWrite(config) {
  const data = `${JSON.stringify(config, null, 2)}\n`
  const tmp = join(dirname(configPath), `.${process.pid}.config.json.tmp`)
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, configPath)
  } catch (error) {
    fail(`cannot write config file ${configPath}: ${error.message}`)
  }
}

const config = readConfig()
const protectedPaths = () =>
  Array.isArray(config.protectedPaths) ? config.protectedPaths : []

if (cmd === 'show') {
  console.log(JSON.stringify(config, null, 2))
} else if (cmd === 'list') {
  for (const entry of protectedPaths()) console.log(entry)
} else if (cmd === 'rules') {
  console.log(typeof config.rulesText === 'string' ? config.rulesText : '')
} else if (cmd === 'set-rules') {
  const text = process.env.FORTRESS_RULES ?? ''
  if (text.trim().length === 0) fail('rules text must not be empty')
  config.rulesText = text
  atomicWrite(config)
  console.log('rules updated')
} else if (cmd === 'add') {
  const target = normalizePath(process.env.FORTRESS_TARGET)
  const list = protectedPaths()
  if (list.some((entry) => typeof entry === 'string' && normalizePath(entry) === target)) {
    console.log('already protected')
  } else {
    list.push(target)
    config.protectedPaths = list
    atomicWrite(config)
    console.log(`protected: ${target}`)
  }
} else if (cmd === 'remove') {
  const raw = process.env.FORTRESS_TARGET
  const target = normalizePath(raw)
  const list = protectedPaths()
  const index = list.findIndex(
    (entry) => typeof entry === 'string' && normalizePath(entry) === target,
  )
  if (index === -1) {
    console.log(`not protected: ${raw}`)
  } else {
    list.splice(index, 1)
    config.protectedPaths = list
    atomicWrite(config)
    console.log(`unprotected: ${target}`)
  }
} else {
  fail(`unknown command: ${cmd}`)
}
JS
)"
}

# 命令判断：动态 import 插件源码，直接调用它的导出函数
run_test() {
  FORTRESS_CONFIG="${CONFIG}" PLUGIN_ENTRY="${PLUGIN_ENTRY}" node \
    --experimental-strip-types --no-warnings --input-type=module -e "$(cat <<'JS'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const command = process.env.FORTRESS_COMMAND
const configPath = process.env.FORTRESS_CONFIG
const entry = process.env.PLUGIN_ENTRY

function fail(message) {
  console.error(`protect.sh: ${message}`)
  process.exit(1)
}

// 用 FORTRESS_CONFIG 里的 protectedPaths 作为判断输入；
// 读不到 / 格式不对时返回 undefined，交回插件自己的默认配置。
function pathsOverride() {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    if (!Array.isArray(parsed.protectedPaths)) return undefined
    const entries = parsed.protectedPaths.filter(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
    return entries.length > 0 ? entries : undefined
  } catch {
    return undefined
  }
}

let mod
try {
  mod = await import(pathToFileURL(entry).href)
} catch (error) {
  fail(`cannot load plugin entry ${entry}: ${error.message}`)
}

const reasons = []
if (mod.isProtectedRemoval(command)) {
  reasons.push('命中受保护删除规则 protectedRemovalPatterns')
}
if (mod.isProtectedPathModification(command, pathsOverride())) {
  reasons.push('命令的写 / 删 / 移动目标落在 protectedPaths 内')
}

if (reasons.length === 0) {
  console.log('ALLOWED')
} else {
  console.log('BLOCKED')
  for (const reason of reasons) console.log(`reason: ${reason}`)
}
JS
)"
}

main() {
  local command="${1:-help}"
  if [ "$#" -gt 0 ]; then shift; fi

  case "${command}" in
    add)
      [ "$#" -eq 1 ] || die "usage: protect.sh add <path>"
      FORTRESS_CMD=add FORTRESS_TARGET="$1" run_edit
      ;;
    remove)
      [ "$#" -eq 1 ] || die "usage: protect.sh remove <path>"
      FORTRESS_CMD=remove FORTRESS_TARGET="$1" run_edit
      ;;
    list)
      [ "$#" -eq 0 ] || die "usage: protect.sh list"
      FORTRESS_CMD=list run_edit
      ;;
    rules)
      [ "$#" -eq 0 ] || die "usage: protect.sh rules"
      FORTRESS_CMD=rules run_edit
      ;;
    set-rules)
      [ "$#" -ge 1 ] || die "usage: protect.sh set-rules <text>"
      FORTRESS_CMD=set-rules FORTRESS_RULES="$*" run_edit
      ;;
    show)
      [ "$#" -eq 0 ] || die "usage: protect.sh show"
      FORTRESS_CMD=show run_edit
      ;;
    test)
      [ "$#" -ge 1 ] || die "usage: protect.sh test <command>"
      FORTRESS_COMMAND="$1" run_test
      ;;
    help|--help|-h)
      usage
      ;;
    *)
      usage >&2
      die "unknown subcommand: ${command}"
      ;;
  esac
}

main "$@"
