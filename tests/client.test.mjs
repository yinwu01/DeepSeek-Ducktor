// client/client.js (the Ducktor sidebar tab) outside a browser: its parsers against the .duck/ files
// a real DeepSeek run wrote, and its view against a stub createElement.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, test } from 'node:test'
import { readCards } from '../lib/cards.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const fixture = join(here, 'fixtures', 'duck-files')

/** Run the bundle the way the page's module loader does, with React replaced by a tree builder. */
function loadClient() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const react = { createElement, useState: () => { throw new Error('hooks need a page') } }
  let exports
  const window = { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, 'deepseek-ducktor'); exports = factory(() => react) } } }
  runInNewContext(readFileSync(join(repo, 'client', 'client.js'), 'utf8'), { window, globalThis: {}, console })
  return exports
}

/** All text in a stub tree, in order. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node.children.map(textOf).join('')
}

const client = loadClient()
const { parseSwitch, parseDecisions, parseNotebook, parseReport, pickCards, buildModel } = client.parse
const read = name => readFileSync(join(fixture, name), 'utf8')
// Values made inside the vm carry its own Array prototype; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value))

describe('module shape', () => {
  test('the loader gets the package name and a cordis plugin', () => {
    assert.equal(client.name, 'deepseek-ducktor')
    assert.ok(client.inject.includes('sidebarRightTabs'))
    assert.equal(typeof client.apply, 'function')
  })
  test('package.json serves this file as ./client for the web platform', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.equal(pkg.exports['./client'], './client/client.js')
    assert.equal(pkg.dsh.client.platform, 'web')
    assert.ok(pkg.files.includes('client/'))
  })
})

describe('parsers on a real run', () => {
  test('switch', () => {
    assert.equal(parseSwitch('# x\n\n开关：on\n'), 'on')
    assert.equal(parseSwitch('开关：quiet'), 'quiet')
    assert.equal(parseSwitch(undefined), 'unset')
    // Read the way Ducktor's bin/duck.js reads it: Chinese values, an English label, bad values.
    assert.equal(parseSwitch('开关：关'), 'off')
    assert.equal(parseSwitch('- **开关**：静音'), 'quiet')
    assert.equal(parseSwitch('# Ducktor settings\n\nSwitch: on\n'), 'on')
    assert.equal(parseSwitch('开关：maybe'), 'unset')
  })
  test('decisions: one per tagged segment, newest first, 待你确认 recognised', () => {
    const decisions = parseDecisions(read('decisions.md'))
    // 4 lines; the first has three tagged segments.
    assert.equal(decisions.length, 6)
    assert.match(decisions[0].text, /skip_attn\.py/)
    assert.equal(decisions[0].who, 'ai')
    assert.equal(decisions[0].editable, true)
    const confirm = decisions.filter(d => d.who === 'confirm')
    assert.equal(confirm.length, 1)
    assert.match(confirm[0].text, /收窄为 dense attention/)
    // The oldest line's three segments keep their own order at the end.
    assert.deepEqual(plain(decisions.slice(-3).map(d => d.who)), ['ai', 'student', 'ai'])
    assert.equal(decisions.at(-2).text, '补 3 个 seed')
    assert.equal(decisions.at(-1).text, '加 XAttention 基线')
  })
  test('notebook: stage, principle, source, this time, card ids', () => {
    const notes = parseNotebook(read('notebook.md'))
    assert.ok(notes.length >= 5)
    const quantile = notes.find(note => note.stage === '做实验')
    assert.match(quantile.principle, /90% 分位数配 > 是保留前 10%/)
    assert.match(quantile.source, /numpy\.percentile/)
    assert.match(quantile.thisTime, /^skip_attn\.py/)
    const review = notes.find(note => note.stage === '投稿前')
    assert.deepEqual(plain(review.cards), ['E02'])
  })
  test('reports: the why report has a check section, the polish report a 卡片提醒', () => {
    const why = parseReport(read('reports/2026-10-25-why.md'))
    assert.match(why.title, /duck-why/)
    assert.ok(why.checks.some(check => check.heading === '要核对的话'))
    const polish = parseReport(read('reports/2026-10-25-polish.md'))
    assert.ok(polish.checks.some(check => /自己先做/.test(check.heading)))
    assert.ok(polish.cards.length > 0)
  })
})

describe('model and view', () => {
  const cards = readCards([join(repo, 'duck', 'cards')])
  const reports = readdirSync(join(fixture, 'reports')).sort().reverse()
    .map(name => ({ name, path: `.duck/reports/${name}`, text: read(`reports/${name}`) }))
  const raw = { config: '开关：on\n', decisions: read('decisions.md'), notebook: read('notebook.md'), reports, errors: [] }

  test('cards come from what the steps name', () => {
    const model = buildModel(raw, cards)
    assert.ok(model.cards.length > 0 && model.cards.length <= 4)
    assert.ok(model.cards.some(card => card.id === 'E02'))
    assert.equal(model.latestChecks.name, reports.find(r => parseReport(r.text).checks.length > 0).name)
  })
  test('English decision lines carry who decided', () => {
    const lines = parseDecisions([
      '- 2026-10-27 ▸ Decision: seeds 1→3, not a single run (you decided)',
      '- 2026-10-27 ▸ Decision: report mean ± std, not the best run (AI decided)',
      '- 2026-10-27 ▸ Decision: keep τ fixed (you decided); drop the 64k row (AI decided, you can change)',
    ].join('\n'))
    assert.equal(lines.map(d => d.who).join(','), 'student,ai,ai,student') // newest line first
    assert.ok(lines.every(d => !/^Decision/i.test(d.text)), lines.map(d => d.text).join(' | '))
    assert.equal(lines.find(d => d.text.startsWith('seeds')).text, 'seeds 1→3, not a single run')
    assert.equal(lines.filter(d => d.editable).length, 1)
    const [zhNested] = parseDecisions('- 2026-10-27 ▸ 决策：主表换成 3 seeds（你定，见 (表 3)）')
    assert.equal(zhNested.who, 'student')
    const [notTag] = parseDecisions('- 2026-10-27 ▸ 决策：学习率 (固定)')
    assert.equal(notTag.tag, '')
  })
  test('Chinese notebook lines with half-width brackets keep their source', () => {
    const [nested] = parseNotebook('- 10-20 摸方向｜先找最接近的前作再定空白（参照 Hamming (1986) You and Your Research）｜这次：E07 那篇')
    assert.equal(nested.principle, '先找最接近的前作再定空白')
    assert.equal(nested.source, '参照 Hamming (1986) You and Your Research')
    const [plain] = parseNotebook('- 10-21 做实验｜先在小模型上复现 (Qwen2.5-7B)｜这次：主表')
    assert.equal(plain.principle, '先在小模型上复现 (Qwen2.5-7B)')
    assert.equal(plain.source, '')
    const [ownJudgment] = parseNotebook('- 10-02 做实验｜原则 B (自己的判断)｜这次：二')
    assert.equal(ownJudgment.source, '自己的判断')
    const [halfCard] = parseNotebook('- 10-02 做实验｜差距要大过波动 (卡 E05 差距要大过种子间的波动)｜这次：主表')
    assert.equal(halfCard.cards.join(','), 'E05')
    const [nestedEn] = parseNotebook('- 10-27 Experiments｜Compare gaps to the spread (card E05 (seeds))｜This time: 3 seeds')
    assert.equal(nestedEn.source, 'card E05 (seeds)')
  })
  test('an English report shows its checks and cards', () => {
    const report = parseReport('# Review\n\n## 2.2 Validity checks and evaluation interface\n- outline item\n\n## 7. Self-consistency checks\n- ran by the AI\n\n## Next time, do this first\n- rerun the main table with 3 seeds\n\n## Card reminders\n- E05 a gap must beat the seed spread\n')
    assert.equal(report.checks.map(s => s.heading).join('|'), 'Next time, do this first')
    assert.equal(report.cards.join(','), 'E05')
  })
  test('an English notebook line splits the same way', () => {
    const [note] = parseNotebook('- 10-27 Experiments｜Report mean ± std over seeds (card E05, a gap must beat the seed spread)｜This time: 3 seeds for the tables')
    assert.equal(note.stage, 'Experiments')
    assert.equal(note.principle, 'Report mean ± std over seeds')
    assert.equal(note.source, 'card E05, a gap must beat the seed spread')
    assert.equal(note.thisTime, '3 seeds for the tables')
    assert.equal(note.cards.join(','), 'E05')
  })
  test('with no named card, the latest stage picks by 「什么时候用」', () => {
    const notes = parseNotebook('- 10-25 润色｜先砍虚词（paper-polish）｜这次：摘要')
    const picked = pickCards(cards, notes, [])
    assert.ok(picked.length > 0)
    assert.ok(picked.every(card => /润色|写/.test(card.when)))
  })
  test('the panel names the three things in the order the student reads them', () => {
    const tree = client.view.panelView(buildModel(raw, cards), { loading: false, open: {}, toggle() {}, refresh() {}, openReport() {} })
    const text = textOf(tree)
    const order = ['这次 AI 替你定的', '可以带走的原则', '该你亲手核对的', '导师会提醒你的', '报告'].map(title => text.indexOf(title))
    assert.ok(order.every(index => index >= 0), text.slice(0, 200))
    assert.deepEqual([...order].sort((a, b) => a - b), order)
    // The decision waiting for the student is drawn first.
    const items = []
    const walk = node => { if (node && typeof node === 'object') { if (node.props['data-who'] && node.props.className === 'ds-ducktor-item') items.push(node.props['data-who']); node.children.forEach(walk) } }
    walk(tree)
    assert.equal(items[0], 'confirm')
    assert.equal(items.length, 6)
    assert.doesNotMatch(text, /还没在这个项目开启/)
  })
  test('a project without .duck/ gets the how-to-start note and nothing else', () => {
    const text = textOf(client.view.panelView(buildModel({ errors: [] }, cards), { loading: false, open: {}, toggle() {}, refresh() {} }))
    assert.match(text, /还没在这个项目开启/)
    assert.match(text, /\/duck on/)
    assert.doesNotMatch(text, /这次 AI 替你定的/)
  })
  test('switched on but nothing written yet: no 「/duck on」 hint', () => {
    const text = textOf(client.view.panelView(buildModel({ config: '开关：on\n', errors: [] }, cards), { loading: false, open: {}, toggle() {}, refresh() {} }))
    assert.match(text, /还没有记录/)
    assert.doesNotMatch(text, /\/duck on/)
  })
  test('off reads as not turned on, the way the hub says it, never as switched off', () => {
    const text = textOf(client.view.panelView(buildModel({ config: '开关：off\n', errors: [] }, cards), { loading: false, open: {}, toggle() {}, refresh() {} }))
    assert.match(text, /没开启（开关写着 off，和刚装好时一样）/)
    assert.match(text, /\/duck on/)
    assert.doesNotMatch(text, /关着|关掉/)
  })
  test('a tag that is neither 你定 nor AI 定 is shown as written', () => {
    // A real DeepSeek turn in the Web GUI wrote this line (2026-10-26).
    const line = '- 2026-10-26 ▸ 决策：判 Accept with Revisions、缩范围重写，不按现稿投 10-30（我定）；保留 64-token 块与免训练路线（我定）'
    const decisions = parseDecisions(line)
    assert.equal(decisions.length, 2)
    assert.ok(decisions.every(d => d.who === 'other' && d.tag === '我定'))
    const tree = client.view.panelView(buildModel({ config: '开关：on\n', decisions: line, errors: [] }, cards), { loading: false, open: {}, toggle() {}, refresh() {} })
    const chips = []
    const walk = node => { if (node && typeof node === 'object') { if (node.props.className === 'ds-ducktor-chip' && !node.props['data-switch']) chips.push(textOf(node)); node.children.forEach(walk) } }
    walk(tree)
    assert.deepEqual(chips, ['没写清谁定的：我定', '没写清谁定的：我定'])
  })
  test('background lines keep their links', () => {
    const model = buildModel({ ...raw, background: '# 领域背景\n\n## 代表作\n- 经典：XAttention（2025）https://arxiv.org/abs/2503.16428\n' }, cards)
    const tree = client.view.panelView(model, { loading: false, open: {}, toggle() {}, refresh() {} })
    const links = []
    const walk = node => { if (node && typeof node === 'object') { if (node.type === 'a') links.push(node.props.href); node.children.forEach(walk) } }
    walk(tree)
    assert.ok(links.includes('https://arxiv.org/abs/2503.16428'))
    // A ## heading is drawn as a label, not as raw markdown.
    assert.match(textOf(tree), /代表作经典/)
    assert.doesNotMatch(textOf(tree), /##/)
  })
})
