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
function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v'
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
export function splitCommand(command: string): string[][] {
  const text = typeof command === 'string' ? command : ''
  const segments: string[][] = []
  let tokens: string[] = []
  let token = ''
  let started = false

  const endToken = (): void => {
    if (started) {
      tokens.push(token)
      token = ''
      started = false
    }
  }
  const endSegment = (): void => {
    endToken()
    segments.push(tokens)
    tokens = []
  }

  const len = text.length
  let i = 0

  while (i < len) {
    const ch = text[i]

    // 单引号：原样吞到下一个单引号，内部反斜杠不转义。
    if (ch === "'") {
      started = true
      i += 1
      while (i < len && text[i] !== "'") {
        token += text[i]
        i += 1
      }
      if (i < len) i += 1 // 吃掉收尾单引号
      continue
    }

    // 双引号：仅 \" 与 \\ 转义，其余反斜杠保留原样。
    if (ch === '"') {
      started = true
      i += 1
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
          token += text[i + 1]
          i += 2
        } else {
          token += text[i]
          i += 1
        }
      }
      if (i < len) i += 1 // 吃掉收尾双引号
      continue
    }

    // 引号外反斜杠：转义下一个字符；行尾孤零零的反斜杠保留为普通字符。
    if (ch === '\\') {
      started = true
      if (i + 1 < len) {
        token += text[i + 1]
        i += 2
      } else {
        token += '\\'
        i += 1
      }
      continue
    }

    // 段分隔符（先于空白判断，\n 是分隔符而非空白）。
    if (ch === '&' && text[i + 1] === '&') {
      endSegment()
      i += 2
      continue
    }
    if (ch === '|' && text[i + 1] === '|') {
      endSegment()
      i += 2
      continue
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      endSegment()
      i += 1
      continue
    }

    // 空白：结束当前 token，连续空白自然合并。
    if (isBlank(ch)) {
      endToken()
      i += 1
      continue
    }

    // 普通字符。
    started = true
    token += ch
    i += 1
  }

  endSegment()
  return segments
}
