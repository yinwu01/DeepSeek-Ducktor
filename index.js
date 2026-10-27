/**
 * deepseek-supervisor: Doctor Duck as a native DeepSeek Harness (dsh) plugin.
 *
 * Two pieces, both reading the Doctor Duck copy in duck/ (or Config.duckRoot):
 *   commands  the /duck-* skills through a skill provider. The base directory dsh shows
 *             the model is the Doctor Duck root, so the instruction dsh adds ("resolve
 *             relative paths against the base directory") agrees with the commands' own
 *             "paths are relative to the plugin root".
 *   context   what Doctor Duck's SessionStart hook gives Claude Code and Codex (plugin root,
 *             the project's switch, the resident rules when the duck is on), built by the
 *             same duck/bin/duck.js. It enters the first model request of a session, and
 *             again when it changes or compaction drops it, the way dsh's own AGENTS.md
 *             loader does. Subagents do not get it: they cannot ask the student.
 *
 * duck/ is a verbatim copy of Doctor Duck (scripts/sync-duck.mjs); host differences live in
 * this file and lib/duck.js.
 */

import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCards } from './lib/cards.js'
import { duckSkills, MENTOR_CARDS, parseSkill, projectOf, PROVIDER, resolveDuckRoot, stepWantsContext, withContext } from './lib/duck.js'

/**
 * Import a package dsh itself ships. Installed with `dsh plugin add` or the Plugins page, the
 * plugin resolves it through dsh's peer handling. Loaded by absolute path from a
 * cordis.patch.yml row, plain resolution finds nothing, so resolve it from files inside the
 * running dsh installation instead, first anchor that works.
 * @param {string} specifier - package name.
 * @param {readonly (string | undefined)[]} anchors - absolute paths of files inside dsh.
 */
async function hostImport(specifier, anchors) {
  try {
    return await import(specifier)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    for (const anchor of anchors) {
      const file = resolveFrom(anchor, specifier)
      if (file !== undefined) return import(pathToFileURL(file).href)
    }
    throw error
  }
}

function resolveFrom(anchor, specifier) {
  if (!anchor) return undefined
  try {
    return createRequire(realpathSync(anchor)).resolve(specifier)
  } catch {
    return undefined
  }
}

// Only the settings schema is needed before apply(). Without it (no anchor found) the plugin
// still loads; the row's settings then arrive unchecked, and apply() treats missing ones as
// their defaults.
const z = await hostImport('@deepseek-ai/schemastery', [process.argv[1]])
  .then(module => module.default, () => undefined)

/** Cordis plugin identity. */
export const name = 'deepseek-supervisor'
/** Skill registry for the commands, agent registry for the session context. */
export const inject = ['skills', 'agents']

/** Row configuration; every field is optional. */
export const Config = z?.object({
  duckRoot: z.string().min(1)
    .description('Absolute path of a Doctor Duck checkout to use instead of the copy shipped in this package.'),
  sessionContext: z.boolean().default(true)
    .description('Give each session Doctor Duck\'s opening context (plugin root, switch, resident rules). Off leaves only the commands.'),
  subagents: z.boolean().default(false)
    .description('Also give the opening context to subagent sessions.'),
})

/**
 * Register the commands and, unless turned off, the per-session context.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ duckRoot?: string, sessionContext?: boolean, subagents?: boolean }} config
 */
export async function apply(ctx, config) {
  // Without the schema an empty `config:` arrives as null.
  config ??= {}
  if (Config === undefined) ctx.logger.warn('@deepseek-ai/schemastery not found; settings are used unchecked')
  const root = resolveDuckRoot(config.duckRoot)
  // Every dsh launcher, Desktop's included, names a file inside its own dsh package here.
  const anchors = [ctx.get('profileContext')?.installAnchor, process.argv[1]]
  const { BUNDLED_SKILL_RANK } = await hostImport('@deepseek-ai/dsh-skill', anchors)
  // dsh-llm is a peer of dsh-skill, so it sits next to wherever dsh-skill was found.
  const { createUserMessage } = await hostImport('@deepseek-ai/dsh-llm',
    [...anchors.map(anchor => resolveFrom(anchor, '@deepseek-ai/dsh-skill')), ...anchors])
  const candidates = duckSkills(root, BUNDLED_SKILL_RANK)
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
  // The Ducktor sidebar tab (client/client.js) shows the experience cards; only the Web GUI's page
  // server emits this event, so other profiles skip it.
  const cards = readCards([join(root, 'cards'), MENTOR_CARDS])
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DEEPSEEK_SUPERVISOR__', value: { cards } })
  })
  ctx.logger.info('Doctor Duck at %s: %d commands, %d cards, session context %s', root, candidates.length,
    cards.length, config.sessionContext === false ? 'off' : 'on')
  if (config.sessionContext === false) return

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next()
    if (signal.aborted || !stepWantsContext({ agent, step, decision, subagents: config.subagents })) return decision
    return withContext(decision, { agent, messages }, { root, project: projectOf(agent), makeMessage: createUserMessage })
  })
}
