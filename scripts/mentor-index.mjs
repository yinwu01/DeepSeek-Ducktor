// Write mentor/cards/INDEX.md from the cards' front matter, in the shape of duck/cards/INDEX.md.
//   node scripts/mentor-index.mjs          write it
//   node scripts/mentor-index.mjs --check  exit 1 if the file on disk differs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCards } from '../lib/cards.js'
import { MENTOR_CARDS } from '../lib/duck.js'

export function mentorIndex(cards) {
  return [
    '# 经验卡片目录（DeepSeek-Ducktor）',
    '',
    '这个插件在 Ducktor 自带的卡片之外加的卡，讲正常科研节奏里导师会教、插件根目录 cards/ 没讲的事：读论文、进新方向、实验习惯、和导师开会、用 AI 审稿。格式、认同程度三档和 cards/INDEX.md 一样；卡号和那边不重。项目里 .duck/cards/ 的卡是学生和课题组的规矩，同号时以那边为准。',
    '',
    '| 卡号 | 标题 | 认同程度 | 什么时候用 | 文件 |',
    '|---|---|---|---|---|',
    ...cards.map(card => `| ${card.id} | ${card.title} | ${card.strength} | ${card.when} | ${card.id}.md |`),
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = join(MENTOR_CARDS, 'INDEX.md')
  const text = mentorIndex(readCards([MENTOR_CARDS]))
  if (process.argv.includes('--check')) {
    let current = ''
    try { current = readFileSync(file, 'utf8') } catch {}
    if (current !== text) {
      console.error(`${file} is out of date; run node scripts/mentor-index.mjs`)
      process.exit(1)
    }
  } else {
    writeFileSync(file, text)
    console.log(`wrote ${file}`)
  }
}
