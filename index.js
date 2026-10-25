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
 *             again when it changes or compaction drops it, the way dsh's own AGENTS.md
 *             loader does. Subagents do not get it: they cannot ask the student.
 *
 * duck/ is a verbatim copy of Doctor Duck (scripts/sync-duck.mjs); host differences live in
 * this file and lib/duck.js.
 */

import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { duckSkills, parseSkill, PROVIDER, resolveDuckRoot, stepWantsContext, withContext } from './lib/duck.js'

/**
 * Import a package dsh itself ships. Installed with `dsh plugin add`, the plugin resolves it
 * through dsh's peer handling; loaded by absolute path from a cordis.patch.yml row (no pnpm),
 * plain resolution finds nothing, so resolve it from the running dsh installation instead.
 * @param {string} specifier - package name.
 */
async function hostImport(specifier) {
  try {
    return await import(specifier)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !process.argv[1]) throw error
    const fromDsh = createRequire(realpathSync(process.argv[1])).resolve(specifier)
    return import(pathToFileURL(fromDsh).href)
  }
}

const { default: z } = await hostImport('@deepseek-ai/schemastery')
const { BUNDLED_SKILL_RANK } = await hostImport('@deepseek-ai/dsh-skill')
const { createUserMessage } = await hostImport('@deepseek-ai/dsh-llm')

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

/**
 * Register the commands and, unless turned off, the per-session context.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ duckRoot?: string, sessionContext?: boolean, subagents?: boolean }} config
 */
export function apply(ctx, config = {}) {
  const root = resolveDuckRoot(config.duckRoot)
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
  ctx.logger.info('Doctor Duck at %s: %d commands, session context %s', root, candidates.length,
    config.sessionContext === false ? 'off' : 'on')
  if (config.sessionContext === false) return

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next()
    if (signal.aborted || !stepWantsContext({ agent, step, decision, subagents: config.subagents })) return decision
    const workingDirectory = ctx.get('workingDirectory')
    const project = workingDirectory !== undefined
      ? await workingDirectory.ensure(agent, signal)
      : agent.session.meta?.cwd ?? process.cwd()
    signal.throwIfAborted()
    return withContext(decision, { agent, messages }, { root, project, makeMessage: createUserMessage })
  })
}
