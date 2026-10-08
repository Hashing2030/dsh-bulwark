/**
 * dsh-fortress 卡 2：shell-tokenizer 单元测试
 *
 * 纯函数测试：不依赖 DSH 运行时，只用 node:assert/strict。
 * 运行：node --experimental-strip-types tests/shell-tokenizer.test.ts
 */

import assert from 'node:assert/strict'
import { splitCommand } from '../packages/dsh-plugin-host-template/src/shell-tokenizer.ts'

// ---------------------------------------------------------------------------
// 迷你测试框架（与 tests/e2e.test.ts 同款）
// ---------------------------------------------------------------------------

let passed = 0
const failures: string[] = []

function group(title: string): void {
  console.log(`\n── ${title}`)
}

function check(id: string, description: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${id} ${description}`)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    failures.push(`[${id}] ${description}\n      ${raw.split('\n').join('\n      ')}`)
    console.log(`  ✗ ${id} ${description}`)
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

group('基础切分')

check('1', 'ls -la → 单段两个 token', () => {
  assert.deepEqual(splitCommand('ls -la'), [['ls', '-la']])
})

check('2', "echo 'a b' → 单引号内空格不切分", () => {
  assert.deepEqual(splitCommand("echo 'a b'"), [['echo', 'a b']])
})

check('3', 'echo "a b" → 双引号内空格不切分', () => {
  assert.deepEqual(splitCommand('echo "a b"'), [['echo', 'a b']])
})

check('4', 'echo "a && b" → 引号内分隔符不算', () => {
  assert.deepEqual(splitCommand('echo "a && b"'), [['echo', 'a && b']])
})

check('5', 'echo \\"hi\\" → 反斜杠转义引号', () => {
  assert.deepEqual(splitCommand('echo \\"hi\\"'), [['echo', '"hi"']])
})

group('段分隔符')

check('6', 'a && b → 两段', () => {
  assert.deepEqual(splitCommand('a && b'), [['a'], ['b']])
})

check('7', 'a || b → 两段', () => {
  assert.deepEqual(splitCommand('a || b'), [['a'], ['b']])
})

check('8', 'a ; b → 两段', () => {
  assert.deepEqual(splitCommand('a ; b'), [['a'], ['b']])
})

check('9', 'a | b → 两段', () => {
  assert.deepEqual(splitCommand('a | b'), [['a'], ['b']])
})

check('10', 'a\\nb → 换行切段', () => {
  assert.deepEqual(splitCommand('a\nb'), [['a'], ['b']])
})

check('11', 'cd /tmp && echo "x y" ; rm -f z → 三段', () => {
  assert.deepEqual(splitCommand('cd /tmp && echo "x y" ; rm -f z'), [
    ['cd', '/tmp'],
    ['echo', 'x y'],
    ['rm', '-f', 'z'],
  ])
})

group('边界与转义')

check('12', '空串 → [[]]', () => {
  assert.deepEqual(splitCommand(''), [[]])
})

check('13', "' && ' → 两个空段", () => {
  assert.deepEqual(splitCommand(' && '), [[], []])
})

check('14', `echo 'a "b" c' → 单引号内的双引号是普通字符`, () => {
  assert.deepEqual(splitCommand(`echo 'a "b" c'`), [['echo', 'a "b" c']])
})

check('15', 'echo a \\&\\& b → 转义的 && 不是分隔符', () => {
  assert.deepEqual(splitCommand('echo a \\&\\& b'), [['echo', 'a', '&&', 'b']])
})

check('16', "echo 'a\\nb' → 单引号内反斜杠不转义", () => {
  assert.deepEqual(splitCommand("echo 'a\\nb'"), [['echo', 'a\\nb']])
})

check('17', '连续空白字符合并成一个分隔', () => {
  assert.deepEqual(splitCommand('ls   \t  -la'), [['ls', '-la']])
})

check('18', 'null / undefined / 非字符串 → [[]]，不抛错', () => {
  assert.deepEqual(splitCommand(null as never), [[]])
  assert.deepEqual(splitCommand(undefined as never), [[]])
  assert.deepEqual(splitCommand(42 as never), [[]])
})

check('19', '未闭合引号：剩余内容当普通 token，不抛错', () => {
  assert.deepEqual(splitCommand('echo "a b'), [['echo', 'a b']])
})

check('20', '双引号内 \\\\ → \\，其余反斜杠原样保留', () => {
  // 实际输入：echo "a\\b \c"
  assert.deepEqual(splitCommand('echo "a\\\\b \\c"'), [['echo', 'a\\b \\c']])
})

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log(`\n${passed}/${passed + failures.length} passed`)

if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}
