#!/usr/bin/env node
// Copy Ducktor's content into duck/ from one exact commit, and record it in duck.lock.json.
//   node scripts/sync-duck.mjs [--from <Ducktor checkout; default: the Ducktor folder next to this repo>] [--ref <git ref>]
//   node scripts/sync-duck.mjs --check     verify duck/ still matches duck.lock.json
// duck/ is never edited by hand: the adapter adds DeepSeek Harness behavior in index.js only,
// so the rules and commands stay the ones Claude Code and Codex users get. The e2e fixture
// project comes along from the same commit.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(HERE, 'duck')
const LOCK = join(HERE, 'duck.lock.json')
// What the commands and the session context read at run time. Host manifests, hooks,
// tests, evals and docs stay in Ducktor. package.json keeps duck/bin/duck.js CommonJS
// inside this ESM package.
const PATHS = ['bin', 'cards', 'handbook', 'library', 'rules', 'skills', 'LICENSE', 'LICENSES', 'package.json']
// The grad-student fixture project the end-to-end flows run on; test-only, not published.
const FIXTURE_SOURCE = 'tests/fixtures/grad-project'
const FIXTURE = join(HERE, 'tests', 'e2e', 'fixtures', 'grad-project')

function args(argv) {
  const out = { from: resolve(HERE, '..', 'Ducktor'), ref: 'main', check: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') out.from = resolve(argv[++i])
    else if (argv[i] === '--ref') out.ref = argv[++i]
    else if (argv[i] === '--check') out.check = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return out
}

function git(from, ...rest) {
  return execFileSync('git', ['-C', from, ...rest], { encoding: 'utf8' }).trim()
}

function hashTree(root) {
  const files = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files[relative(root, full).split(sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex')
    }
  }
  walk(root)
  return files
}

function compare(label, expected, root) {
  const now = hashTree(root)
  const problems = []
  for (const [file, sum] of Object.entries(expected)) {
    if (!(file in now)) problems.push(`missing: ${label}${file}`)
    else if (now[file] !== sum) problems.push(`changed: ${label}${file}`)
  }
  for (const file of Object.keys(now)) if (!(file in expected)) problems.push(`extra: ${label}${file}`)
  return { problems, count: Object.keys(now).length }
}

function check() {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'))
  const duck = compare('duck/', lock.files, TARGET)
  const fixture = compare('tests/e2e/fixtures/grad-project/', lock.fixtureFiles, FIXTURE)
  const problems = [...duck.problems, ...fixture.problems]
  if (problems.length > 0) {
    console.error(`differs from duck.lock.json (Ducktor ${lock.source.commit.slice(0, 7)}):\n${problems.join('\n')}`)
    process.exit(1)
  }
  console.log(`duck/ and the fixture match Ducktor ${lock.source.commit.slice(0, 7)} (${duck.count} + ${fixture.count} files)`)
}

// Extract paths of one commit into a fresh directory; strip drops leading path parts.
function extract(from, commit, paths, into, strip = 0) {
  rmSync(into, { recursive: true, force: true })
  mkdirSync(into, { recursive: true })
  const tar = execFileSync('git', ['-C', from, 'archive', '--format=tar', commit, '--', ...paths], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', into, `--strip-components=${strip}`], { input: tar })
  return hashTree(into)
}

function sync({ from, ref }) {
  const commit = git(from, 'rev-parse', '--verify', `${ref}^{commit}`)
  const committedAt = git(from, 'show', '-s', '--format=%cI', commit)
  const subject = git(from, 'show', '-s', '--format=%s', commit)
  const files = extract(from, commit, PATHS, TARGET)
  const fixtureFiles = extract(from, commit, [FIXTURE_SOURCE], FIXTURE, FIXTURE_SOURCE.split('/').length)
  const lock = {
    note: 'duck/ and tests/e2e/fixtures/grad-project are verbatim copies of these Ducktor paths at this commit. Re-run scripts/sync-duck.mjs instead of editing them.',
    source: { repository: 'JoeyWu-tech/Ducktor', ref, commit, committedAt, subject },
    paths: PATHS,
    files,
    fixture: FIXTURE_SOURCE,
    fixtureFiles,
  }
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`copied ${Object.keys(files).length} files into duck/ and ${Object.keys(fixtureFiles).length} into the e2e fixture from Ducktor ${commit.slice(0, 7)} (${ref})`)
}

const options = args(process.argv.slice(2))
if (options.check) check()
else sync(options)
