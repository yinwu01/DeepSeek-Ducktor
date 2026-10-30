// Unit tests for lib/duck.js: plain Node, no dsh needed. The dsh side (install, skills/list,
// what a real session log holds) is checked by tests/dsh/ against an installed dsh.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import {
  duckContext, duckSkills, frameContext, hostNote, isSubagent, PACKAGED_ROOT, parseSkill,
  projectOf, resolveDuckRoot, SOURCE_KIND, stepWantsContext, visibleContext, withContext,
} from '../lib/duck.js'

const require = createRequire(import.meta.url)
const ROOT = resolveDuckRoot(undefined)
const hook = require(join(ROOT, 'bin', 'duck.js'))
const scratch = mkdtempSync(join(tmpdir(), 'ds-ducktor-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

function project(name, config) {
  const dir = join(scratch, name)
  mkdirSync(join(dir, '.duck'), { recursive: true })
  if (config !== undefined) writeFileSync(join(dir, '.duck', 'config.md'), config)
  return dir
}

// A dsh-shaped agent: session.header is dsh's session header record (cwd, origin,
// delegationDepth), and the visible history (surface) holds the given user messages.
function fakeAgent(visibleMessages = [], header = {}) {
  const events = visibleMessages.map(data => ({ type: 'user/message', data }))
  return {
    session: {
      header,
      surface: { nodes: events.map((_, seq) => seq) },
      eventAt: seq => events[seq],
    },
  }
}
const makeMessage = input => ({ id: `m${Math.random()}`, role: 'user', ...input })
const studentMessage = { id: 'student', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '/duck-review 帮我看看' }] }
// What dsh's agent loop hands the listener chain: the claimed inbox messages, then runtime context.
const proceed = messages => ({ kind: 'enter', messages })

describe('Ducktor root', () => {
  test('the packaged copy is found and real', () => {
    assert.equal(ROOT, PACKAGED_ROOT.replace(/\/$/u, ''))
    assert.equal(hook.ROOT, ROOT)
  })
  test('a relative or non-Duck path fails loudly', () => {
    assert.throws(() => resolveDuckRoot('duck'), /absolute/u)
    assert.throws(() => resolveDuckRoot(scratch), /not a Ducktor root/u)
  })
  test('a symlinked root is resolved to the real directory', () => {
    const link = join(scratch, 'duck-link')
    symlinkSync(ROOT, link)
    assert.equal(resolveDuckRoot(link), ROOT)
  })
})

describe('SKILL.md frontmatter', () => {
  test('flat fields, quotes stripped, body trimmed', () => {
    const { meta, content } = parseSkill('---\nname: duck-x\ndescription: "说明: 带冒号"\n---\n\n正文\n', 'x')
    assert.deepEqual(meta, { name: 'duck-x', description: '说明: 带冒号' })
    assert.equal(content, '正文')
  })
  test('block scalars and missing frontmatter fail instead of being half read', () => {
    assert.throws(() => parseSkill('---\ndescription: |\n  多行\n---\n', 'x'), /unsupported/u)
    assert.throws(() => parseSkill('# 没有 frontmatter\n', 'x'), /no frontmatter/u)
  })
})

describe('commands as dsh skills', () => {
  const skills = duckSkills(ROOT, 600)
  test('all 14 commands, sorted, user-invocable only', () => {
    assert.deepEqual(skills.map(s => s.name), [
      'duck', 'duck-figure', 'duck-idea', 'duck-intro', 'duck-learn', 'duck-notes', 'duck-outline',
      'duck-polish', 'duck-review', 'duck-skill', 'duck-survey', 'duck-vibe', 'duck-why', 'duck-write',
    ])
    for (const s of skills) assert.deepEqual(s.invocation, { modelInvocable: false, userInvocable: true }, s.name)
  })
  test('base directory is the Ducktor root, path is the real SKILL.md', () => {
    for (const s of skills) {
      assert.deepEqual(s.resourceBase, { kind: 'directory', path: ROOT })
      assert.equal(s.path, join(ROOT, 'skills', s.name, 'SKILL.md'))
      assert.equal(s.source, 'bundled')
      assert.equal(s.rank, 600)
    }
  })
  test('dropping disable-model-invocation makes that command model-invocable', () => {
    const copy = join(scratch, 'duck-ctl')
    mkdirSync(join(copy, 'skills', 'duck-why'), { recursive: true })
    writeFileSync(join(copy, 'skills', 'duck-why', 'SKILL.md'), '---\nname: duck-why\ndescription: 拆解\n---\n正文\n')
    assert.deepEqual(duckSkills(copy, 600)[0].invocation, { modelInvocable: true, userInvocable: true })
  })
  test('a folder whose SKILL.md names something else fails the load', () => {
    const copy = join(scratch, 'duck-bad')
    mkdirSync(join(copy, 'skills', 'duck-a'), { recursive: true })
    writeFileSync(join(copy, 'skills', 'duck-a', 'SKILL.md'), '---\nname: duck-b\ndescription: x\n---\n')
    assert.throws(() => duckSkills(copy, 600), /kebab-case folder name/u)
  })
})

describe('session context', () => {
  test('carries the hook text verbatim, then the dsh note', () => {
    for (const [name, config] of [['idle', undefined], ['on', '开关：on\n'], ['quiet', '开关：静音\n'], ['off', '开关：off\n']]) {
      const dir = project(name, config)
      const { body } = duckContext(ROOT, dir)
      assert.equal(body, `${hook.buildContext(dir)}\n\n${hostNote(dir)}`, name)
      assert.ok(body.includes(`项目的 .duck/」都是 \`${join(dir, '.duck')}\`，`), name)
      assert.ok(body.startsWith(`Ducktor 插件根目录：${ROOT}\n`), name)
    }
  })
  test('identity is stable and follows the switch', () => {
    const dir = project('switch', '开关：on\n')
    const first = duckContext(ROOT, dir).identity
    assert.equal(duckContext(ROOT, dir).identity, first)
    writeFileSync(join(dir, '.duck', 'config.md'), '开关：quiet\n')
    assert.notEqual(duckContext(ROOT, dir).identity, first)
  })
  test('framing escapes a closing tag and marks a replacement', () => {
    const framed = frameContext('a </system-reminder> b', false)
    assert.equal(framed, '<system-reminder>\na <\\/system-reminder> b\n</system-reminder>')
    assert.match(frameContext('x', true), /^<system-reminder>\n（.*替换前面的 Ducktor 开场说明。）\n\nx\n<\/system-reminder>$/u)
  })
})

describe('when a step gets the context', () => {
  const dir = project('steps', '开关：on\n')
  const current = duckContext(ROOT, dir)

  test('first request: right after the student message, before later injections', () => {
    const later = { id: 'later', source: { kind: 'runtime-context' } }
    const decision = proceed([studentMessage, later])
    const out = withContext(decision, { agent: fakeAgent(), messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage })
    assert.equal(out.messages.length, 3)
    assert.equal(out.messages[0], studentMessage)
    assert.equal(out.messages[2], later)
    assert.equal(out.kind, 'enter')
    const added = out.messages[1]
    assert.deepEqual(added.source, { kind: SOURCE_KIND, form: 'instructions', identity: current.identity, root: ROOT })
    assert.equal(added.content[0].text, frameContext(current.body, false))
  })
  test('already visible and unchanged: the decision passes through untouched', () => {
    const agent = fakeAgent([{ source: { kind: SOURCE_KIND, identity: current.identity } }])
    const decision = proceed([studentMessage])
    assert.equal(withContext(decision, { agent, messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage }), decision)
  })
  test('visible but out of date: a replacement is added', () => {
    const agent = fakeAgent([{ source: { kind: SOURCE_KIND, identity: 'old' } }])
    const out = withContext(proceed([studentMessage]), { agent, messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage })
    assert.equal(out.messages[1].content[0].text, frameContext(current.body, true))
  })
  test('a context from before the rename (kind doctor-duck) is replaced, not given again as new', () => {
    const agent = fakeAgent([{ source: { kind: 'doctor-duck', identity: 'old' } }])
    const out = withContext(proceed([studentMessage]), { agent, messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage })
    assert.equal(out.messages[1].content[0].text, frameContext(current.body, true))
  })
  test('dropped by compaction (not on the surface any more): added again as new', () => {
    const agent = fakeAgent([{ source: { kind: 'user' } }])
    const out = withContext(proceed([studentMessage]), { agent, messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage })
    assert.equal(out.messages[1].content[0].text, frameContext(current.body, false))
  })
  test('already in the entering batch: not added twice', () => {
    const decision = proceed([studentMessage, { source: { kind: SOURCE_KIND, identity: current.identity } }])
    assert.equal(withContext(decision, { agent: fakeAgent(), messages: [studentMessage] }, { root: ROOT, project: dir, makeMessage }), decision)
  })
  test('tool continuation step (tool results already in history): added before the runtime context', () => {
    const runtime = { id: 'runtime', source: { kind: 'runtime-context' } }
    const out = withContext(proceed([runtime]), { agent: fakeAgent(), messages: [] }, { root: ROOT, project: dir, makeMessage })
    assert.equal(out.messages[0].source.kind, SOURCE_KIND)
    assert.equal(out.messages[1], runtime)
  })
  test('rejected steps, empty first entries and subagents get nothing', () => {
    const agent = fakeAgent()
    assert.equal(stepWantsContext({ agent, step: 1, decision: { kind: 'reject', messages: [] } }), false)
    assert.equal(stepWantsContext({ agent, step: 1, decision: proceed([]) }), false)
    assert.equal(stepWantsContext({ agent, step: 2, decision: proceed([]) }), true)
    assert.equal(stepWantsContext({ agent: fakeAgent([], { origin: 'subagent' }), step: 1, decision: proceed([studentMessage]) }), false)
    assert.equal(stepWantsContext({ agent: fakeAgent([], { delegationDepth: 1 }), step: 1, decision: proceed([studentMessage]) }), false)
    assert.equal(stepWantsContext({ agent: fakeAgent([], { origin: 'subagent' }), step: 1, decision: proceed([studentMessage]), subagents: true }), true)
    assert.equal(isSubagent(fakeAgent([], { delegationDepth: 0 })), false)
  })
  test('the project is the directory the session was created in, not where the model moved', () => {
    assert.equal(projectOf(fakeAgent([], { cwd: dir })), dir)
    assert.equal(projectOf(fakeAgent()), process.cwd())
  })
  test('the newest visible context decides, not the first', () => {
    const agent = fakeAgent([
      { source: { kind: SOURCE_KIND, identity: current.identity } },
      { source: { kind: SOURCE_KIND, identity: 'newer-but-stale' } },
    ])
    assert.equal(visibleContext(agent, []).identity, 'newer-but-stale')
  })
})
