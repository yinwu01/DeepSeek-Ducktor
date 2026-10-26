/**
 * The host-independent half of deepseek-ducktor: finding the Doctor Duck root, turning its
 * SKILL.md files into dsh skill candidates, building the session context with Doctor Duck's
 * own hook code, and deciding when a model step needs that context. No dsh imports here, so
 * tests run with plain Node.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `source.kind` of the context messages; also how a later step finds the visible one. */
export const SOURCE_KIND = 'doctor-duck'
/** Skill provider name in dsh's registry. */
export const PROVIDER = 'doctor-duck'
/** The Doctor Duck copy shipped in this package. */
export const PACKAGED_ROOT = fileURLToPath(new URL('../duck/', import.meta.url))
const REMINDER_CLOSE = '</system-reminder>'

/**
 * Said once per context message, after Doctor Duck's own text. Doctor Duck's rules name
 * Claude Code's tools; this maps them to dsh's and states what dsh does differently. The
 * project is spelled out because dsh lets the model move its working directory, and the
 * commands' "the project's .duck/" must keep meaning the directory this context was read from.
 * @param {string} project - absolute project directory.
 */
export function hostNote(project) {
  return [
    '## 在 DeepSeek Harness 里',
    '- 上面这段开场说明由 deepseek-ducktor 插件给出，和 Claude Code、Codex 里开场 hook 注入的是同一份。项目的 .duck/config.md 改了，或者对话被压缩过，会再给一份，以最新的一份为准。',
    `- 这个会话的项目目录是 \`${project}\`。上文和命令里说的「项目的 .duck/」都是 \`${join(project, '.duck')}\`，会话里换了工作目录也不变，读写都用这个绝对路径。`,
    '- 命令和 Claude Code 一样，敲 /duck-review 这类短名；学生在输入框里敲 / 能看到全部命令。',
    '- 上文的 Read、Glob、Grep，在这里是 read、glob、grep 工具。插件根目录在工作区外面，用它们读不需要学生批准；插件根目录只读不写，学生的东西写进项目的 .duck/。',
  ].join('\n')
}

const REPLACING_LEAD = '（项目的 .duck/config.md 或 Doctor Duck 的规则变了，或者对话被压缩过：这一份替换前面的 Doctor Duck 开场说明。）'

/**
 * Resolve and check the Doctor Duck root. Symlinks are resolved so every path given to the
 * model is real (with a symlinked skill folder, "two levels up" missed library/ before).
 * @param {string | undefined} configured - Config.duckRoot.
 * @returns {string} the real absolute root.
 */
export function resolveDuckRoot(configured) {
  const root = configured ?? PACKAGED_ROOT
  if (!isAbsolute(root)) throw new Error(`deepseek-ducktor: duckRoot must be an absolute path, got ${JSON.stringify(root)}`)
  const real = realpathSync(root)
  for (const file of ['bin/duck.js', 'rules/core.md', 'skills/duck/SKILL.md']) {
    if (!statSync(join(real, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`deepseek-ducktor: ${real} is not a Doctor Duck root (no ${file})`)
    }
  }
  return real
}

/**
 * Split a SKILL.md into its frontmatter fields and body. Doctor Duck's frontmatter is flat
 * `key: value` lines; anything else fails the load instead of being half read.
 * @param {string} raw - file text.
 * @param {string} file - path for error messages.
 * @returns {{ meta: Record<string, string>, content: string }}
 */
export function parseSkill(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match === null) throw new Error(`deepseek-ducktor: ${file} has no frontmatter`)
  const meta = {}
  for (const line of match[1].split(/\r?\n/u)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][\w-]*):[ \t]*(.*)$/u.exec(line)
    if (field === null || /^[|>]/u.test(field[2])) {
      throw new Error(`deepseek-ducktor: ${file}: unsupported frontmatter line ${JSON.stringify(line)}`)
    }
    let value = field[2].trim()
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1)
    meta[field[1]] = value
  }
  return { meta, content: raw.slice(match[0].length).trim() }
}

/**
 * Build dsh skill candidates for every skills/<name>/SKILL.md under the root. The resource
 * base is the root itself: Doctor Duck's commands say their paths are relative to it.
 * @param {string} root - real Doctor Duck root.
 * @param {number} rank - dsh's rank for packaged skills (BUNDLED_SKILL_RANK).
 */
export function duckSkills(root, rank) {
  const posixRoot = root.split(sep).join('/')
  const candidates = []
  for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(root, 'skills', entry.name, 'SKILL.md')
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue
    const { meta } = parseSkill(readFileSync(file, 'utf8'), file)
    if (meta.name !== entry.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(meta.name)) {
      throw new Error(`deepseek-ducktor: ${file}: name ${JSON.stringify(meta.name)} must be the kebab-case folder name`)
    }
    if (!meta.description) throw new Error(`deepseek-ducktor: ${file} has no description`)
    candidates.push({
      name: meta.name,
      description: meta.description,
      ...meta.whenToUse ? { whenToUse: meta.whenToUse } : {},
      invocation: {
        modelInvocable: meta['disable-model-invocation'] !== 'true',
        userInvocable: meta['user-invocable'] !== 'false',
      },
      provider: PROVIDER,
      source: 'bundled',
      rank,
      path: file.split(sep).join('/'),
      resourceBase: { kind: 'directory', path: posixRoot },
      locator: file,
    })
  }
  if (candidates.length === 0) throw new Error(`deepseek-ducktor: no commands under ${join(root, 'skills')}`)
  return candidates.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The opening context Doctor Duck's hook would give for this project, plus the dsh note.
 * @param {string} root - real Doctor Duck root.
 * @param {string} project - the session's working directory.
 * @returns {{ body: string, identity: string }} identity changes whenever the body does.
 */
export function duckContext(root, project) {
  let hookText
  try {
    // Same code path as the SessionStart hook (duck.js main('session-start')), minus stdin.
    hookText = createRequire(import.meta.url)(join(root, 'bin', 'duck.js')).buildContext(project)
  } catch (error) {
    hookText = `Doctor Duck 插件根目录：${root}\n\n（开场脚本出错，常驻规则这次没加载：${error instanceof Error ? error.message : String(error)}）`
  }
  const body = `${hookText}\n\n${hostNote(project)}`
  return { body, identity: createHash('sha256').update(body).digest('hex').slice(0, 16) }
}

/**
 * Frame a context body the way dsh frames its own workspace instructions.
 * @param {string} body - from duckContext.
 * @param {boolean} replacing - an older Doctor Duck context is still visible in the session.
 */
export function frameContext(body, replacing) {
  const lead = replacing ? `${REPLACING_LEAD}\n\n` : ''
  return `<system-reminder>\n${lead}${body.replaceAll(REMINDER_CLOSE, '<\\/system-reminder>')}\n${REMINDER_CLOSE}`
}

/**
 * Newest Doctor Duck context source in the entering batch or the visible (post-compaction)
 * history, or undefined.
 */
export function visibleContext(agent, batch) {
  for (let i = batch.length - 1; i >= 0; i -= 1) {
    if (batch[i].source?.kind === SOURCE_KIND) return batch[i].source
  }
  const nodes = agent.session.surface?.nodes ?? []
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = agent.session.eventAt(nodes[i])
    if (event?.type === 'user/message' && event.data.source?.kind === SOURCE_KIND) return event.data.source
  }
  return undefined
}

/** True for sessions created as subagent children (dsh records it in the session header). */
export function isSubagent(agent) {
  const header = agent.session.header ?? {}
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

/**
 * The project whose .duck/ the context reads: the directory the session was created in, as the
 * SessionStart hook sees it. Not the current working directory, which the model can move.
 */
export function projectOf(agent) {
  return agent.session.header?.cwd ?? process.cwd()
}

/**
 * Whether this step should carry the context at all, before any file is read. Same guards as
 * dsh's AGENTS.md loader: a rejected step, or an empty first entry (a turn with no request),
 * carries nothing; the next real step gets the context.
 */
export function stepWantsContext({ agent, step, decision, subagents }) {
  if (decision.kind === 'reject') return false
  if (step === 1 && decision.messages.length === 0) return false
  if (subagents !== true && isSubagent(agent)) return false
  return true
}

/**
 * Add the context to a proceeding pre-step decision when it is missing or out of date.
 * @param {object} decision - the decision returned by `next()`.
 * @param {{ agent: object, messages: readonly object[] }} step - the pre-step payload.
 * @param {{ root: string, project: string, makeMessage: (input: object) => object }} options
 *   makeMessage is dsh's createUserMessage.
 * @returns the same decision, or a copy with the context right after the student's messages.
 */
export function withContext(decision, { agent, messages }, { root, project, makeMessage }) {
  const visible = visibleContext(agent, decision.messages)
  const { body, identity } = duckContext(root, project)
  if (visible?.identity === identity) return decision
  const message = makeMessage({
    content: [{ type: 'text', text: frameContext(body, visible !== undefined) }],
    source: { kind: SOURCE_KIND, form: 'instructions', identity, root },
  })
  // Right after the student's own messages, like dsh's workspace instructions; a /duck-*
  // command's body is appended later in the chain, so the command still comes after it.
  const lastClaimed = decision.messages.findLastIndex(m => messages.includes(m))
  return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
}
