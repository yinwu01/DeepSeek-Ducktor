/**
 * deepseek-ducktor: Doctor Duck as a native DeepSeek Harness (dsh) plugin.
 *
 * Two pieces, both reading the Doctor Duck copy in duck/ (or Config.duckRoot):
 *   commands  the /duck-* skills through a skill provider. The base directory dsh shows
 *             the model is the Doctor Duck root, so the instruction dsh adds ("resolve
 *             relative paths against the base directory") agrees with the commands' own
 *             "paths are relative to the plugin root".
 *   context   what Doctor Duck's SessionStart hook gives Claude Code and Codex (plugin root,
 *             the project's switch, the resident rules when the duck is on), built by the
 *             same duck/bin/duck.js. It enters the first model request of a session, and
 *             again when it changes or compaction drops it, the way dsh's own
 *             AGENTS.md loader does. Subagents do not get it: they cannot ask the student.
 *
 * duck/ is a verbatim copy of Doctor Duck (scripts/sync-duck.mjs); host differences live here.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin identity. */
export const name = 'deepseek-ducktor'
/** Skill registry for the commands, agent registry for the session context. */
export const inject = ['skills', 'agents']

/** Row configuration; every field is optional. */
export const Config = z.object({
  duckRoot: z.string().min(1)
    .description('Absolute path of a Doctor Duck checkout to use instead of the copy shipped in this package.'),
  sessionContext: z.boolean().default(true)
    .description('Give each session Doctor Duck\'s opening context (plugin root, switch, resident rules). Off leaves only the commands.'),
  subagents: z.boolean().default(false)
    .description('Also give the opening context to subagent sessions.'),
})

/** `source.kind` of the context messages; also how a later step finds the visible one. */
export const SOURCE_KIND = 'doctor-duck'
const PROVIDER = 'doctor-duck'
const PACKAGED_ROOT = fileURLToPath(new URL('./duck/', import.meta.url))
const REMINDER_CLOSE = '</system-reminder>'

// Said once per context message, after Doctor Duck's own text. Doctor Duck's rules name
// Claude Code's tools; this maps them to dsh's and states what dsh does differently.
export const HOST_NOTE = [
  '## 在 DeepSeek Harness 里',
  '- 上面这段开场说明由 deepseek-ducktor 插件给出，和 Claude Code、Codex 里开场 hook 注入的是同一份。项目的 .duck/config.md 改了，或者对话被压缩过，会再给一份，以最新的一份为准。',
  '- 命令和 Claude Code 一样，敲 /duck-review 这类短名；学生在输入框里敲 / 能看到全部命令。',
  '- 上文的 Read、Glob、Grep，在这里是 read、glob、grep 工具。插件根目录在工作区外面，用它们读不需要学生批准；插件根目录只读不写，学生的东西写进项目的 .duck/。',
].join('\n')

/**
 * Resolve and check the Doctor Duck root; symlinks are resolved so every path given to the
 * model is real (a symlinked skill directory made "two levels up" miss library/ before).
 * @param {string | undefined} configured - Config.duckRoot.
 * @returns {string} the real absolute root.
 */
export function resolveDuckRoot(configured) {
  const root = configured ?? PACKAGED_ROOT
  if (!isAbsolute(root)) throw new Error(`${name}: duckRoot must be an absolute path, got ${JSON.stringify(root)}`)
  const real = realpathSync(root)
  for (const file of ['bin/duck.js', 'rules/core.md', 'skills/duck/SKILL.md']) {
    if (!statSync(join(real, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${name}: ${real} is not a Doctor Duck root (no ${file})`)
    }
  }
  return real
}

/**
 * Split a SKILL.md into its frontmatter fields and body. Doctor Duck's frontmatter is flat
 * `key: value` lines; anything else fails the load instead of being half read.
 * @param {string} raw - file text.
 * @param {string} file - path for error messages.
 */
export function parseSkill(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match === null) throw new Error(`${name}: ${file} has no frontmatter`)
  const meta = {}
  for (const line of match[1].split(/\r?\n/u)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][\w-]*):[ \t]*(.*)$/u.exec(line)
    if (field === null || /^[|>]/u.test(field[2])) {
      throw new Error(`${name}: ${file}: unsupported frontmatter line ${JSON.stringify(line)}`)
    }
    let value = field[2].trim()
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1)
    meta[field[1]] = value
  }
  return { meta, content: raw.slice(match[0].length).trim() }
}

/**
 * Build the skill candidates for every skills/<name>/SKILL.md under the root.
 * @param {string} root - real Doctor Duck root.
 */
export function duckSkills(root) {
  const posixRoot = root.split(sep).join('/')
  const candidates = []
  for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(root, 'skills', entry.name, 'SKILL.md')
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue
    const { meta } = parseSkill(readFileSync(file, 'utf8'), file)
    if (meta.name !== entry.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(meta.name)) {
      throw new Error(`${name}: ${file}: name ${JSON.stringify(meta.name)} must be the kebab-case folder name`)
    }
    if (!meta.description) throw new Error(`${name}: ${file} has no description`)
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
      rank: BUNDLED_SKILL_RANK,
      path: file.split(sep).join('/'),
      resourceBase: { kind: 'directory', path: posixRoot },
      locator: file,
    })
  }
  if (candidates.length === 0) throw new Error(`${name}: no commands under ${join(root, 'skills')}`)
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
  const body = `${hookText}\n\n${HOST_NOTE}`
  return { body, identity: createHash('sha256').update(body).digest('hex').slice(0, 16) }
}

/**
 * Frame a context body the way dsh frames its own workspace instructions.
 * @param {string} body - from duckContext.
 * @param {boolean} replacing - an older Doctor Duck context is still visible in the session.
 */
export function frameContext(body, replacing) {
  const lead = replacing ? '（项目的 .duck/config.md 或 Doctor Duck 的规则变了，或者对话被压缩过：这一份替换前面的 Doctor Duck 开场说明。）\n\n' : ''
  return `<system-reminder>\n${lead}${body.replaceAll(REMINDER_CLOSE, '<\\/system-reminder>')}\n${REMINDER_CLOSE}`
}

/** Newest Doctor Duck context source in the entering batch or the visible history. */
function visibleContext(agent, batch) {
  for (const message of [...batch].reverse()) {
    if (message.source?.kind === SOURCE_KIND) return message.source
  }
  const nodes = agent.session.surface?.nodes ?? []
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const event = agent.session.eventAt(nodes[i])
    if (event?.type === 'user/message' && event.data.source?.kind === SOURCE_KIND) return event.data.source
  }
  return undefined
}

/** True for sessions created as subagent children. */
function isSubagent(agent) {
  const meta = agent.session.meta ?? {}
  return meta.origin === 'subagent' || (meta.delegationDepth ?? 0) > 0
}

/**
 * Register the commands and, unless turned off, the per-session context.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ duckRoot?: string, sessionContext?: boolean, subagents?: boolean }} config
 */
export function apply(ctx, config = {}) {
  const root = resolveDuckRoot(config.duckRoot)
  const candidates = duckSkills(root)
  ctx.skills.registerProvider(() => ({
    name: PROVIDER,
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator, { encoding: 'utf8', signal: options.signal })
      const { meta, content } = parseSkill(raw, locator)
      if (meta.name !== candidate.name) return undefined
      return { ...summary, content }
    },
  }))
  ctx.logger.info('Doctor Duck at %s: %d commands, session context %s', root, candidates.length,
    config.sessionContext === false ? 'off' : 'on')
  if (config.sessionContext === false) return

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next()
    // Same guards as dsh's AGENTS.md loader: a rejected step or an empty first entry
    // (a turn with no request) carries nothing; the next real step gets the context.
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (step === 1 && decision.messages.length === 0) return decision
    if (config.subagents !== true && isSubagent(agent)) return decision
    const workingDirectory = ctx.get('workingDirectory')
    const project = workingDirectory !== undefined
      ? await workingDirectory.ensure(agent, signal)
      : agent.session.meta?.cwd ?? process.cwd()
    signal.throwIfAborted()
    const visible = visibleContext(agent, decision.messages)
    const { body, identity } = duckContext(root, project)
    if (visible?.identity === identity) return decision
    const message = createUserMessage({
      content: [{ type: 'text', text: frameContext(body, visible !== undefined) }],
      source: { kind: SOURCE_KIND, form: 'instructions', identity, root },
    })
    // Right after the student's own messages, like dsh's workspace instructions; a /duck-*
    // command's body is appended after every injection, so it still comes last.
    const lastClaimed = decision.messages.findLastIndex(m => messages.includes(m))
    return { ...decision, messages: decision.messages.toSpliced(lastClaimed + 1, 0, message) }
  })
}
