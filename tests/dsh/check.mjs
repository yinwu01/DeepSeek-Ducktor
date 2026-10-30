#!/usr/bin/env node
// Checks deepseek-ducktor against an installed DeepSeek Harness without an API key: nothing
// reaches a model, because with no key dsh stops at MISSING_CREDENTIAL right before the request
// (the session log already holds every message the request would have carried). Everything
// happens in a fresh temporary HOME; DEEPSEEK_API_KEY is removed from the environment.
//
//   node tests/dsh/check.mjs [--route pnpm|patch|ui] [--web] [--keep]
//
//   --route pnpm   install with `dsh plugin --profile <p> add <this checkout>` (default; pnpm on PATH)
//   --route patch  install with a row in $DSH_HOME/cordis.patch.yml (all profiles, no pnpm)
//   --route ui     install and remove inside a running `dsh web` through the calls its Plugins
//                  page makes (pluginManager/installBundle with this checkout's path); implies --web
//   --web          also boot `dsh web` on a free local port: skills/list and one prompt
//   --keep         keep the temporary HOME and print where it is
//
// Environment: DSH, the dsh command (default: dsh on PATH). Run it without network, e.g. under
// `unshare -rn` with loopback up, to be sure nothing leaves the machine.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { duckContext, duckSkills, frameContext, isSubagent, projectOf, resolveDuckRoot, SOURCE_KIND } from '../../lib/duck.js'

const require = createRequire(import.meta.url)
const { readSessionEvents, sessionLogPath } = require('../e2e/session-log.cjs')

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'))
const argv = process.argv.slice(2)
const ROUTE = argv.includes('--route') ? argv[argv.indexOf('--route') + 1] : 'pnpm'
const WEB = argv.includes('--web') || ROUTE === 'ui'
const KEEP = argv.includes('--keep')
if (!['pnpm', 'patch', 'ui'].includes(ROUTE)) {
  console.error('usage: node tests/dsh/check.mjs [--route pnpm|patch|ui] [--web] [--keep]')
  process.exit(2)
}
const DSH = process.env.DSH || 'dsh'
const ROOT = resolveDuckRoot(undefined)

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ds-ducktor-dsh-')))
const HOME = join(scratch, 'home')
const DSH_HOME = join(HOME, '.dsh')
const PROJECT = join(scratch, 'project')
mkdirSync(join(PROJECT, '.duck'), { recursive: true })
// A repository root, so dsh looks for AGENTS.md and CLAUDE.md here and not in the folders above.
spawnSync('git', ['init', '-q', PROJECT])
const env = {
  ...process.env, HOME, DSH_HOME,
  XDG_CONFIG_HOME: join(HOME, '.config'), XDG_DATA_HOME: join(HOME, '.local', 'share'),
  XDG_CACHE_HOME: join(HOME, '.cache'), XDG_STATE_HOME: join(HOME, '.local', 'state'),
  npm_config_store_dir: join(HOME, '.pnpm-store'), DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', BROWSER: '/bin/false',
}
delete env.DEEPSEEK_API_KEY
delete env.DSH_PERMISSION_MODE

const results = []
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok) })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${String(detail).slice(0, 400)}`}`)
}
const dsh = (args, cwd = PROJECT) => spawnSync(DSH, args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300000 })
const setSwitch = (mode) => writeFileSync(join(PROJECT, '.duck', 'config.md'), `# Ducktor 设定\n\n开关：${mode}\n`)

// User messages a headless run added to its session, in order.
const seen = new Map()
function headless(task, session) {
  const run = dsh(['--profile', 'headless', '--json', ...(session ? ['--session-id', session] : []), task])
  const opening = run.stdout.split('\n').find(line => line.startsWith('{"type":"session"'))
  const id = session ?? (opening ? JSON.parse(opening).sessionId : '')
  const file = id && sessionLogPath(DSH_HOME, id)
  const events = file ? readSessionEvents(file) : []
  const fresh = events.filter(e => typeof e.seq === 'number' && e.seq > (seen.get(id) ?? -1))
  if (events.length) seen.set(id, events.at(-1).seq)
  return { run, id, users: fresh.filter(e => e.type === 'user/message').map(e => e.data) }
}
const textOf = message => message.content.map(c => c.text ?? '').join('')
const kinds = users => users.map(m => (m.source?.kind === 'skill-invocation' ? `skill:${m.source.name}` : m.source?.kind)).join(' ')
// The student's message first, then the context, before the command. Other injections (dsh's
// runtime context, an AGENTS.md, the web presets' time) may sit around them.
const contextBefore = (users, command) => {
  const order = kinds(users).split(' ')
  const context = order.indexOf(SOURCE_KIND)
  return order[0] === 'user' && context > 0 && order.lastIndexOf(SOURCE_KIND) === context && order.indexOf(`skill:${command}`) > context
}

// ---------- the session objects of the dsh under test ----------

// Subagent sessions and the project come from session.header in dsh; build two real sessions
// with that dsh's own SessionStore and ask lib/duck.js about them.
async function sessionShape() {
  const command = DSH.includes('/') ? [DSH] : (process.env.PATH ?? '').split(':').map(dir => join(dir, DSH))
  const entry = command.map(file => { try { return realpathSync(file) } catch { return undefined } }).find(Boolean)
  try {
    const { SessionStore } = await import(createRequire(entry).resolve('@deepseek-ai/dsh-session'))
    const store = { store: new Map(), counter: 0, projections: undefined }
    const child = SessionStore.prototype.prepare.call(store, 'session-child', { meta: { cwd: PROJECT, origin: 'subagent', delegationDepth: 1 } })
    const top = SessionStore.prototype.prepare.call(store, 'session-top', { meta: { cwd: PROJECT } })
    check('real dsh sessions: subagent flag and project are read from session.header',
      isSubagent({ session: child }) && !isSubagent({ session: top }) && projectOf({ session: top }) === PROJECT)
  } catch (error) {
    check('real dsh sessions: subagent flag and project are read from session.header', false, error)
  }
}
await sessionShape()

// ---------- install ----------

// pnpm installs per profile; the home-level row reaches every profile.
const PROFILES = WEB ? ['headless', 'web'] : ['headless']
function install() {
if (ROUTE === 'pnpm') {
  for (const profile of PROFILES) {
    const add = dsh(['plugin', '--profile', profile, 'add', REPO])
    check(`dsh plugin --profile ${profile} add <checkout>`, add.status === 0, add.stderr || add.stdout)
  }
} else {
  mkdirSync(DSH_HOME, { recursive: true })
  writeFileSync(join(DSH_HOME, 'cordis.patch.yml'), `- insert:\n    - id: deepseek-ducktor\n      name: ${join(REPO, 'index.js')}\n`)
  check('home-level cordis.patch.yml row written', true)
}
const dump = dsh(['--profile', 'headless', '--dump-config'])
check('the composed headless profile has the deepseek-ducktor row', /- id: deepseek-ducktor\n/u.test(dump.stdout), dump.stderr)
}

// ---------- headless: first request, resume, switch change ----------

function headlessChecks() {
setSwitch('on')
const first = headless('/duck 菜单')
check('keyless run stops at MISSING_CREDENTIAL (no model was asked)', first.run.status === 1 && /MISSING_CREDENTIAL/u.test(first.run.stdout + first.run.stderr), first.run.stderr)
check('the context comes after the student message, once, before the /duck skill', contextBefore(first.users, 'duck'), kinds(first.users))
const context = first.users.find(m => m.source?.kind === SOURCE_KIND)
check('the context is Ducktor\'s own opening text for this project, verbatim', context && textOf(context) === frameContext(duckContext(ROOT, PROJECT).body, false))
check('the context carries the resident rules (switch is on)', context && /# Ducktor 常驻规则/u.test(textOf(context)))
const skill = first.users.find(m => m.source?.kind === 'skill-invocation')
check('the /duck skill\'s base directory is the Ducktor root', skill && textOf(skill).includes(`Base directory for this skill: ${ROOT}\n`))

const again = headless('/duck-why', first.id)
check('resume with nothing changed: no second context', again.users.length > 0 && !again.users.some(m => m.source?.kind === SOURCE_KIND)
  && kinds(again.users).endsWith('skill:duck-why'), kinds(again.users))

setSwitch('quiet')
const quiet = headless('继续', first.id)
const replacement = quiet.users.find(m => m.source?.kind === SOURCE_KIND)
check('switch changed to quiet: a replacement context enters', replacement && textOf(replacement) === frameContext(duckContext(ROOT, PROJECT).body, true), kinds(quiet.users))

setSwitch('off')
const off = headless('/duck-polish 润色摘要')
const offContext = off.users.find(m => m.source?.kind === SOURCE_KIND)
// off is the fresh-install state: the same note as a project that never turned Ducktor on.
check('a new session with the switch off gets the not-turned-on note', offContext && /Ducktor 没在这个项目开启：/u.test(textOf(offContext))
  && /开关：off，和没开启一样/u.test(textOf(offContext)) && !/# Ducktor 常驻规则/u.test(textOf(offContext)))
}

// ---------- web: the surface Desktop also runs ----------

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function web() {
  setSwitch('on')
  const port = await freePort()
  const server = spawn(DSH, ['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], { cwd: PROJECT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise(resolve => server.once('exit', resolve))
  let log = ''
  const token = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 120000)
    const onData = (chunk) => {
      log += chunk
      const found = /[?&]token=([^\s&]+)/u.exec(log)
      if (found) { clearTimeout(timer); resolve(found[1]) }
    }
    server.stdout.on('data', onData)
    server.stderr.on('data', onData)
    server.once('exit', () => { clearTimeout(timer); resolve('') })
  })
  try {
    check('dsh web started and printed its launch link', token !== '', log.slice(-400))
    if (!token) return
    const base = `http://127.0.0.1:${port}`
    const connect = await fetch(`${base}/connect?token=${token}&interactions=none`, { redirect: 'manual' })
    const cookie = (connect.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
    let rpc = 0
    // Arguments go by parameter name, as the Web client sends them.
    const callArgs = async (method, args) => {
      const response = await fetch(`${base}/api/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: `r${rpc += 1}`, method, payload: { args } }),
      })
      return response.json()
    }
    const call = (method, request) => callArgs(method, { request })
    const duckSkillsIn = async (sessionId) => ((await call('skills/list', { sessionId })).result?.value?.skills ?? [])
      .filter(s => s.name === 'duck' || s.name.startsWith('duck-'))
    if (ROUTE === 'ui') {
      const installed = await callArgs('pluginManager/installBundle', { spec: REPO, options: { requestId: `install-${Date.now()}` } })
      check('Plugins page call: installBundle with the checkout path', installed.result?.ok === true, JSON.stringify(installed))
      const bundles = await callArgs('pluginManager/listBundles', {})
      const listed = JSON.stringify(bundles)
      check('Plugins page call: listBundles shows deepseek-ducktor with its own title and description',
        listed.includes('"deepseek-ducktor"') && listed.includes('"DeepSeek-Ducktor"') && listed.includes('讲为什么的科研导师 Ducktor') && listed.includes('Ducktor, a research mentor that explains why'), listed.slice(0, 400))
    }
    const created = await call('session/create', { cwd: PROJECT })
    const sessionId = JSON.stringify(created).match(/"sessionId":"([^"]+)"/u)?.[1]
    check('web: session/create', sessionId, JSON.stringify(created))
    if (!sessionId) return
    const skills = await duckSkillsIn(sessionId)
    const expected = duckSkills(ROOT, 0)
    check('web: skills/list has the 14 commands, user-only, at their real paths',
      skills.length === expected.length && skills.every(s => s.modelInvocable === false && s.path === join(ROOT, 'skills', s.name, 'SKILL.md')),
      JSON.stringify(skills.map(s => [s.name, s.modelInvocable])))
    await call('session/prompt', { requestId: `req-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '/duck-review 帮我看看' }] })
    let users = []
    for (let i = 0; i < 60 && !users.some(m => m.source?.kind === 'skill-invocation'); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const file = sessionLogPath(DSH_HOME, sessionId)
      users = file ? readSessionEvents(file).filter(e => e.type === 'user/message').map(e => e.data) : []
    }
    check('web: the standard preset agent gets the context after the student, before the /duck-review skill',
      contextBefore(users, 'duck-review'), kinds(users))
    if (ROUTE === 'ui') {
      const removed = await callArgs('pluginManager/removeBundle', { name: 'deepseek-ducktor' })
      check('Plugins page call: removeBundle', removed.result?.ok === true, JSON.stringify(removed))
      const later = await call('session/create', { cwd: PROJECT })
      const laterId = JSON.stringify(later).match(/"sessionId":"([^"]+)"/u)?.[1]
      check('after removal in the running web: no /duck-* commands, no restart', laterId && (await duckSkillsIn(laterId)).length === 0)
    }
  } finally {
    server.kill('SIGTERM')
    await exited
  }
}
if (ROUTE !== 'ui') {
  install()
  headlessChecks()
}
if (WEB) await web()

// ---------- removal ----------

if (ROUTE === 'ui') {
  const after = dsh(['web', '--dump-config'])
  check('after removal the web profile has no deepseek-ducktor', after.status === 0 && !/deepseek-ducktor/u.test(after.stdout), after.stderr)
} else {
if (ROUTE === 'pnpm') {
  for (const profile of PROFILES) {
    const remove = dsh(['plugin', '--profile', profile, 'remove', 'deepseek-ducktor'])
    check(`dsh plugin --profile ${profile} remove deepseek-ducktor`, remove.status === 0, remove.stderr || remove.stdout)
    // Not a failure: pnpm may keep the link in the profile's node_modules after the row is gone.
    const link = join(DSH_HOME, 'profiles', profile, 'node_modules', 'deepseek-ducktor')
    let left = false
    try { left = lstatSync(link).isSymbolicLink() || existsSync(link) } catch { left = false }
    console.log(`     note: ${profile} profile node_modules/deepseek-ducktor ${left ? 'still there (pnpm leaves it)' : 'removed'}`)
  }
} else {
  rmSync(join(DSH_HOME, 'cordis.patch.yml'))
}
for (const profile of PROFILES) {
  const after = dsh(profile === 'web' ? ['web', '--dump-config'] : ['--profile', profile, '--dump-config'])
  check(`after removal the ${profile} profile has no deepseek-ducktor`, after.status === 0 && !/deepseek-ducktor/u.test(after.stdout), after.stderr)
}
setSwitch('on')
const gone = headless('/duck 菜单')
check('after removal: no context, no /duck skill', !gone.users.some(m => m.source?.kind === SOURCE_KIND || m.source?.kind === 'skill-invocation'), kinds(gone.users))
}

const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed (${spawnSync(DSH, ['--version'], { env, encoding: 'utf8' }).stdout.trim()}, route ${ROUTE}${WEB ? ', web' : ''})`)
if (KEEP) console.log(`kept ${scratch}`)
else rmSync(scratch, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
