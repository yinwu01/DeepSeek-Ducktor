window.__ModuleLoader__.load({ id: 'deepseek-ducktor', factory: (require) => {
var module = { exports: {} }
// deepseek-ducktor, browser half: the 鸭子 tab in the right sidebar of the dsh Web GUI.
//
// It shows what Doctor Duck already writes into the session's project, so a student sees
// what an agent doing the research would otherwise keep to itself:
//   这次 AI 替你定的   .duck/decisions.md, who made each call, 待你确认 first
//   可以带走的原则     .duck/notebook.md, one rule per step, with its source
//   该你亲手核对的     the check sections of the latest report in .duck/reports/
//   领域背景           .duck/background.md, when the duck wrote one for this direction
//   导师会提醒你的     the experience cards the recent steps point to (sent by the Host half)
// It only reads files through the workspace-files Remote, while the tab is visible, and sends
// nothing to the model. Hand-written, no build step: React comes from the page's module table.

const React = require('react')
const h = React.createElement

const TAB_ID = 'deepseek-ducktor/duck'
const TAB_KIND = 'duck'
const STYLE_ID = 'deepseek-ducktor-style'
const POLL_MS = 4000
const FILES = { config: '.duck/config.md', decisions: '.duck/decisions.md', notebook: '.duck/notebook.md', background: '.duck/background.md' }
const REPORTS = '.duck/reports'

// ---------------------------------------------------------------- parsing (pure)

const TAG = /（([^（）]*定[^（）]*)）\s*$/
const CARD_REF = /\b[A-Z]\d{2}\b/g
const URL_RE = /https?:\/\/[^\s）)，。；、<>"']+/g

function bullets(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, ''))
}

/** on | quiet | off | idle | unset, from config.md's 开关 line. */
function parseSwitch(text) {
  const match = /开关[：:]\s*([a-z]+)/i.exec(String(text ?? ''))
  return match === null ? 'unset' : match[1].toLowerCase()
}

function whoOf(tag) {
  if (/待(你)?确认/.test(tag)) return 'confirm'
  if (/^\s*你定/.test(tag)) return 'student'
  if (/AI\s*定/i.test(tag)) return 'ai'
  return 'other'
}

/** decisions.md: one decision per segment when every 「；」 segment carries its own tag. Newest line first. */
function parseDecisions(text) {
  const lines = []
  for (const line of bullets(text)) {
    const out = []
    lines.unshift(out)
    const match = /^(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2})?\s*(?:▸\s*)?(?:决策[：:]\s*)?([\s\S]*)$/.exec(line)
    const date = match[1] ?? ''
    const body = match[2].trim()
    const segments = body.split('；').map(segment => segment.trim()).filter(Boolean)
    const each = segments.length > 1 && segments.every(segment => TAG.test(segment))
    for (const segment of each ? segments : [body]) {
      const tagMatch = TAG.exec(segment)
      const tag = tagMatch === null ? '' : tagMatch[1]
      out.push({ date, text: tagMatch === null ? segment : segment.slice(0, tagMatch.index).trim(), tag, who: whoOf(tag), editable: /你可改/.test(tag) })
    }
  }
  return lines.flat()
}

/** notebook.md: 「日期 阶段｜原则（出处）｜这次：…」. Lines in another shape keep their text. Newest first. */
function parseNotebook(text) {
  const out = []
  for (const line of bullets(text)) {
    const parts = line.split('｜')
    if (parts.length < 2) {
      out.push({ date: '', stage: '', principle: line, source: '', thisTime: '', cards: [] })
      continue
    }
    const head = /^(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2})?\s*(.*)$/.exec(parts[0].trim())
    let principle = parts[1].trim()
    let source = ''
    const sourceMatch = /（([^（）]*)）\s*$/.exec(principle)
    if (sourceMatch !== null) {
      source = sourceMatch[1]
      principle = principle.slice(0, sourceMatch.index).trim()
    }
    const thisTime = parts.slice(2).join('｜').trim().replace(/^这次[：:]\s*/, '')
    out.push({ date: head[1] ?? '', stage: head[2].trim(), principle, source, thisTime, cards: [...new Set(`${source} ${thisTime}`.match(CARD_REF) ?? [])] })
  }
  return out.reverse()
}

const CHECK_HEADING = /核对|自己先做|导师会盯|交给 ?AI ?的判断/
const CARD_HEADING = /卡片提醒/

/** One report: its title, its check sections, and the cards its 卡片提醒 section names. */
function parseReport(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const titleLine = lines.find(line => /^#\s+/.test(line))
  const sections = []
  let current
  for (const line of lines) {
    const heading = /^#{2,4}\s+(.*)$/.exec(line)
    if (heading !== null) {
      current = { heading: heading[1].trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (current === undefined) continue
    const clean = line.trim().replace(/^>\s?/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim()
    if (clean !== '') current.lines.push(clean)
  }
  const checks = sections.filter(section => CHECK_HEADING.test(section.heading) && section.lines.length > 0)
  const cards = [...new Set(sections.filter(section => CARD_HEADING.test(section.heading))
    .flatMap(section => section.lines.join(' ').match(CARD_REF) ?? []))]
  return { title: titleLine === undefined ? '' : titleLine.replace(/^#\s+/, '').trim(), checks, cards }
}

const STAGE_WORDS = [
  [/润色|改写|写/, ['润色', '写']],
  [/投稿|审稿|审/, ['审稿', '投稿', '主结果']],
  [/实验|代码|跑/, ['实验']],
  [/idea|选题|方向|调研|综述/i, ['idea', '选题', '方向']],
  [/复盘|组会|报告|卡/, ['卡住', '组会', '反馈']],
  [/图/, ['图']],
]

/** The cards to show: those the recent steps name, else those whose 「什么时候用」 fits the latest stage. */
function pickCards(cards, notes, reports, limit = 4) {
  const byId = new Map((cards ?? []).map(card => [card.id, card]))
  const picked = []
  const add = (id) => {
    const card = byId.get(id)
    if (card !== undefined && !picked.includes(card)) picked.push(card)
  }
  for (const note of notes.slice(0, 5)) note.cards.forEach(add)
  for (const report of reports.slice(0, 3)) report.cards.forEach(add)
  if (picked.length === 0 && notes.length > 0) {
    const stage = `${notes[0].stage} ${notes[0].principle}`
    const words = STAGE_WORDS.filter(([pattern]) => pattern.test(stage)).flatMap(([, list]) => list)
    for (const card of byId.values()) if (words.some(word => card.when.includes(word))) add(card.id)
  }
  return picked.slice(0, limit)
}

/** Text with bare URLs turned into links. */
function linkify(text) {
  const out = []
  let last = 0
  for (const match of String(text ?? '').matchAll(URL_RE)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    out.push(h('a', { key: `u${match.index}`, href: match[0], target: '_blank', rel: 'noreferrer' }, match[0]))
    last = match.index + match[0].length
  }
  if (last < String(text ?? '').length) out.push(String(text).slice(last))
  return out
}

/** Everything the panel draws, from the raw file texts. */
function buildModel(raw, cards) {
  const decisions = parseDecisions(raw.decisions)
  const notes = parseNotebook(raw.notebook)
  const reports = (raw.reports ?? []).map(report => ({ name: report.name, path: report.path, ...parseReport(report.text) }))
  const latestChecks = reports.find(report => report.checks.length > 0)
  return {
    switch: parseSwitch(raw.config),
    hasDuck: raw.config !== undefined,
    decisions,
    notes,
    reports,
    latestChecks,
    background: raw.background === undefined ? undefined : String(raw.background).split(/\r?\n/).map(line => line.trim()).filter(line => line !== '' && !/^#\s/.test(line)),
    cards: pickCards(cards, notes, reports),
    errors: raw.errors ?? [],
  }
}

// ---------------------------------------------------------------- view (pure given h)

const SWITCH_LABEL = { on: '开着', quiet: '安静模式', off: '关着', idle: '没开启', unset: '没开启' }
const WHO_LABEL = { confirm: '待你确认', student: '你定的', ai: 'AI 定的', other: '' }

function section(title, count, children, note) {
  return h('section', { className: 'ducktor-section' },
    h('h3', null, title, count ? h('span', { className: 'ducktor-count' }, String(count)) : null),
    note ? h('p', { className: 'ducktor-note' }, note) : null,
    children)
}

function more(items, limit, render, open, toggle, key) {
  const shown = open ? items : items.slice(0, limit)
  return [
    ...shown.map(render),
    items.length > limit ? h('button', { key: `${key}-more`, className: 'ducktor-link', type: 'button', onClick: () => toggle(key) },
      open ? '收起' : `还有 ${items.length - limit} 条`) : null,
  ]
}

function decisionView(decision, index) {
  return h('div', { key: `d${index}`, className: 'ducktor-item', 'data-who': decision.who },
    h('div', null, linkify(decision.text)),
    h('div', { className: 'ducktor-meta' },
      decision.who !== 'other' ? h('span', { className: 'ducktor-chip', 'data-who': decision.who }, WHO_LABEL[decision.who])
        // A tag outside 你定 / AI 定 (a model once wrote 我定) is shown as written, not guessed.
        : decision.tag ? h('span', { className: 'ducktor-chip', title: decision.tag }, `没写清谁定的：${decision.tag}`) : null,
      decision.editable && decision.who !== 'confirm' ? h('span', { className: 'ducktor-chip' }, '你可改') : null,
      decision.date ? h('span', null, decision.date) : null))
}

function noteView(note, index) {
  return h('div', { key: `n${index}`, className: 'ducktor-item' },
    h('div', { className: 'ducktor-principle' }, linkify(note.principle)),
    note.thisTime ? h('div', { className: 'ducktor-this' }, '这次：', linkify(note.thisTime)) : null,
    h('div', { className: 'ducktor-meta' }, [note.stage, note.date, note.source].filter(Boolean).join(' · ')))
}

function cardView(card) {
  return h('details', { key: card.id, className: 'ducktor-item ducktor-card' },
    h('summary', null, h('span', { className: 'ducktor-card-id' }, card.id), card.title,
      card.strength ? h('span', { className: 'ducktor-chip' }, card.strength) : null),
    card.parts.map((part, index) => h('div', { key: index, className: 'ducktor-part' },
      part.label ? h('span', { className: 'ducktor-label' }, `${part.label}：`) : null,
      linkify(part.text),
      part.items.length > 0 ? h('ul', null, part.items.map((item, i) => h('li', { key: i }, linkify(item)))) : null)),
    card.links.length > 0 ? h('div', { className: 'ducktor-meta' }, '出处：',
      card.links.map((link, i) => h('a', { key: i, href: link.url, target: '_blank', rel: 'noreferrer', className: 'ducktor-source' }, link.label))) : null)
}

/**
 * The whole panel.
 * @param {ReturnType<typeof buildModel> | undefined} model
 * @param {{ refresh: () => void, openReport?: (path: string) => void, open: Record<string, boolean>, toggle: (key: string) => void, loading: boolean }} ui
 */
function panelView(model, ui) {
  const header = h('header', { className: 'ducktor-head' },
    h('strong', null, '鸭子'),
    model ? h('span', { className: 'ducktor-chip', 'data-switch': model.switch }, SWITCH_LABEL[model.switch] ?? model.switch) : null,
    h('button', { className: 'ducktor-link ducktor-refresh', type: 'button', onClick: ui.refresh, disabled: ui.loading }, ui.loading ? '读取中' : '刷新'))
  if (model === undefined) return h('div', { className: 'ducktor' }, header, h('p', { className: 'ducktor-note' }, '正在读这个项目的 .duck/ …'))
  const empty = model.decisions.length === 0 && model.notes.length === 0 && model.reports.length === 0
  const on = model.switch === 'on' || model.switch === 'quiet'
  const intro = on && !empty ? null : h('div', { className: 'ducktor-intro' },
    h('p', null, on || (model.hasDuck && model.switch !== 'unset')
      ? `Doctor Duck 在这个项目里${SWITCH_LABEL[model.switch] ?? model.switch}。`
      : 'Doctor Duck 还没在这个项目开启。'),
    on
      ? h('p', null, '还没有记录。AI 做完一步实质性的活，这里会列出它替你定了什么、你能带走的原则、该你亲手核对的地方。')
      : h('p', null, '开启以后，AI 每做一步，这里列出它替你定了什么、你能带走的原则、该你亲手核对的地方。在对话里敲 ', h('code', null, '/duck on'), ' 就开启。'))
  const checks = model.latestChecks
  return h('div', { className: 'ducktor' },
    header,
    intro,
    model.decisions.length > 0 ? section('这次 AI 替你定的', model.decisions.length,
      more([...model.decisions.filter(d => d.who === 'confirm'), ...model.decisions.filter(d => d.who !== 'confirm')], 6, decisionView, ui.open.decisions, ui.toggle, 'decisions'),
      '标着「AI 定的」是它替你拍的板，不对就改；「待你确认」要你回一句。') : null,
    model.notes.length > 0 ? section('可以带走的原则', model.notes.length,
      more(model.notes, 5, noteView, ui.open.notes, ui.toggle, 'notes')) : null,
    checks ? section('该你亲手核对的', 0, [
      ...checks.checks.map((check, i) => h('div', { key: `c${i}`, className: 'ducktor-item' },
        h('div', { className: 'ducktor-label' }, check.heading),
        check.lines.map((line, j) => h('p', { key: j }, linkify(line))))),
      ui.openReport ? h('button', { key: 'open', className: 'ducktor-link', type: 'button', onClick: () => ui.openReport(checks.path) }, `打开《${checks.title || checks.name}》`) : null,
    ]) : null,
    model.background && model.background.length > 0 ? section('领域背景', 0,
      h('div', { className: 'ducktor-item' }, model.background.map((line, i) => /^#{2,6}\s+/.test(line)
        ? h('div', { key: i, className: 'ducktor-label ducktor-subhead' }, line.replace(/^#{2,6}\s+/, ''))
        : h('p', { key: i }, linkify(line.replace(/^[-*]\s+/, '')))))) : null,
    model.cards.length > 0 ? section('导师会提醒你的', 0, model.cards.map(cardView), '经验卡片，每张写明道理、怎么用和出处。') : null,
    model.reports.length > 0 ? section('报告', model.reports.length,
      more(model.reports, 5, (report, i) => h('div', { key: `r${i}` },
        ui.openReport
          ? h('button', { className: 'ducktor-link', type: 'button', onClick: () => ui.openReport(report.path) }, report.title || report.name)
          : h('span', null, report.title || report.name)), ui.open.reports, ui.toggle, 'reports')) : null,
    model.errors.length > 0 ? h('p', { className: 'ducktor-note ducktor-error' }, `有 ${model.errors.length} 个文件读不出来：${model.errors.join('；')}`) : null)
}

const CSS = `
.ducktor{box-sizing:border-box;height:100%;overflow-y:auto;padding:12px 14px 28px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.ducktor-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.ducktor-head strong{font-size:15px;line-height:22px}
.ducktor-refresh{margin-left:auto}
.ducktor-section h3{display:flex;align-items:center;gap:6px;margin:18px 0 6px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ducktor-count{font-weight:400;color:var(--dsw-alias-label-tertiary)}
.ducktor-note{margin:0 0 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ducktor-error{color:var(--dsw-alias-state-error-primary)}
.ducktor-intro{margin:8px 0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.ducktor-intro p{margin:0 0 6px}
.ducktor-intro p:last-child{margin:0;color:var(--dsw-alias-label-secondary)}
.ducktor-item{margin-bottom:6px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.ducktor-item p{margin:2px 0}
.ducktor-item[data-who=confirm]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-warn-primary)}
.ducktor-principle{font-weight:500}
.ducktor-this{margin-top:2px;color:var(--dsw-alias-label-secondary)}
.ducktor-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ducktor-chip{display:inline-block;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;corner-shape:round;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.ducktor-chip[data-who=confirm]{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-primary)}
.ducktor-chip[data-who=student]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.ducktor-chip[data-switch=on]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.ducktor-label{font-weight:600;color:var(--dsw-alias-label-secondary)}
.ducktor-part{margin-top:4px}
.ducktor-subhead{margin-top:8px}
.ducktor-subhead:first-child{margin-top:0}
.ducktor-part ul{margin:2px 0 0;padding-left:18px}
.ducktor-card summary{cursor:pointer;font-weight:500;list-style-position:outside}
.ducktor-card-id{margin-right:6px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.ducktor a,.ducktor-link{color:var(--dsw-alias-link);font-weight:500;text-decoration:none}
.ducktor-source{margin-right:8px}
.ducktor-link{padding:0;border:0;background:none;font:inherit;font-weight:500;cursor:pointer;text-align:left}
.ducktor-link:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.ducktor code{font-size:12px}
@media (hover:hover){.ducktor a:hover,.ducktor-link:not(:disabled):hover{text-decoration:underline dotted;text-underline-offset:3px}}
`

// ---------------------------------------------------------------- host wiring

function fileAddress(sessionId, path) {
  const encode = segment => encodeURIComponent(segment).replace(/%3A/gi, ':')
  return `dsh-resource://file/session/${encode(sessionId)}/${path.split('/').map(encode).join('/')}`
}

function failure(error) {
  return error?.code ?? error?.message ?? String(error)
}

function createReader(remote) {
  const files = () => remote.workspaceFiles
  async function readText(sessionId, path, signal) {
    let result = await files().read(sessionId, path, {}, signal)
    if (!result.ok) return { error: result.error }
    let text = result.value.text
    for (let page = 0; !result.value.eof && page < 20; page++) {
      result = await files().read(sessionId, path, { offset: result.value.offset + result.value.lines }, signal)
      if (!result.ok) return { error: result.error }
      text += result.value.text
    }
    return { text }
  }
  const missing = error => /not-found|not-directory/.test(failure(error))
  return {
    /** A cheap fingerprint of .duck/, so the panel rereads only when something changed. */
    async signature(sessionId, signal) {
      const parts = await Promise.all(Object.values(FILES).map(path => files().stat(sessionId, path, signal)
        .then(result => result.ok ? result.value.version : '-', () => '?')))
      const listing = await files().list(sessionId, REPORTS, signal).then(result => result.ok
        ? result.value.entries.map(entry => `${entry.name}:${entry.size ?? ''}`).join(',') : '-', () => '?')
      return `${parts.join('|')}|${listing}`
    },
    async load(sessionId, signal) {
      const raw = { errors: [] }
      await Promise.all(Object.entries(FILES).map(async ([key, path]) => {
        const result = await readText(sessionId, path, signal)
        if (result.text !== undefined) raw[key] = result.text
        else if (!missing(result.error)) raw.errors.push(`${path}（${failure(result.error)}）`)
      }))
      const listing = await files().list(sessionId, REPORTS, signal)
      raw.reports = []
      if (listing.ok) {
        const names = listing.value.entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.md'))
          .map(entry => entry.name).sort().reverse().slice(0, 12)
        raw.reports = await Promise.all(names.map(async (name) => {
          const path = `${REPORTS}/${name}`
          const result = await readText(sessionId, path, signal)
          return { name, path, text: result.text ?? '' }
        }))
      } else if (!missing(listing.error)) raw.errors.push(`${REPORTS}（${failure(listing.error)}）`)
      return raw
    },
  }
}

function makeBody(reader) {
  return function DuckBody(props) {
    const sessionId = props.sessionId
    const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
    const tab = info?.tab
    const visible = tab?.visible !== false
    const [model, setModel] = React.useState(undefined)
    const [loading, setLoading] = React.useState(false)
    const [open, setOpen] = React.useState({})
    const [nonce, setNonce] = React.useState(0)
    const last = React.useRef('')
    React.useEffect(() => {
      if (!visible || sessionId === undefined) return undefined
      const controller = new AbortController()
      const { signal } = controller
      let timer
      const tick = async (force) => {
        try {
          const signature = await reader.signature(sessionId, signal)
          if (signal.aborted) return
          if (force || signature !== last.current) {
            setLoading(true)
            const raw = await reader.load(sessionId, signal)
            if (signal.aborted) return
            last.current = signature
            setModel(buildModel(raw, globalThis.__DUCKTOR__?.cards))
          }
        } catch (error) {
          if (!signal.aborted) console.error('deepseek-ducktor: reading .duck/ failed', error)
        } finally {
          if (!signal.aborted) {
            setLoading(false)
            timer = setTimeout(() => { void tick(false) }, POLL_MS)
          }
        }
      }
      void tick(nonce > 0)
      return () => {
        controller.abort()
        clearTimeout(timer)
      }
    }, [sessionId, visible, nonce])
    const openReport = typeof tab?.actions?.openResource === 'function'
      ? path => tab.actions.openResource(fileAddress(sessionId, path))
      : undefined
    return panelView(model, {
      loading,
      open,
      toggle: key => setOpen(state => ({ ...state, [key]: !state[key] })),
      refresh: () => setNonce(value => value + 1),
      openReport,
    })
  }
}

function installStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => style.remove()
}

module.exports = {
  name: 'deepseek-ducktor',
  inject: ['slots', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
  apply(ctx) {
    ctx.effect(installStyle, 'deepseek-ducktor: style')
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      keepMounted: false,
      title: () => '鸭子',
      guide: [{ id: 'duck', order: 40, title: () => '鸭子', description: () => 'AI 替你定了什么、能带走的原则、该你核对的' }],
    }), 'deepseek-ducktor: tab type')
    const Body = makeBody(createReader(ctx.remote))
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: TAB_ID },
      Body,
    )), 'deepseek-ducktor: tab body')
  },
  // For tests.
  parse: { parseSwitch, parseDecisions, parseNotebook, parseReport, pickCards, buildModel },
  view: { panelView },
}
return module.exports
} })
