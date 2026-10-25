#!/usr/bin/env node
// Copy Doctor Duck's content into duck/ from one exact commit, and record it in duck.lock.json.
//   node scripts/sync-duck.mjs [--from <Doctor Duck checkout>] [--ref <git ref>]
//   node scripts/sync-duck.mjs --check     verify duck/ still matches duck.lock.json
// duck/ is never edited by hand: the adapter adds DeepSeek Harness behavior in index.js only,
// so the rules and commands stay the ones Claude Code and Codex users get.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(HERE, 'duck')
const LOCK = join(HERE, 'duck.lock.json')
// What the commands and the session context read at run time. Host manifests, hooks,
// tests, evals and docs stay in Doctor Duck. package.json keeps duck/bin/duck.js CommonJS
// inside this ESM package.
const PATHS = ['bin', 'cards', 'handbook', 'library', 'rules', 'skills', 'LICENSE', 'LICENSES', 'package.json']

function args(argv) {
  const out = { from: resolve(HERE, '..', 'mentor-plugin'), ref: 'main', check: false }
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

function check() {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'))
  const now = hashTree(TARGET)
  const problems = []
  for (const [file, sum] of Object.entries(lock.files)) {
    if (!(file in now)) problems.push(`missing: ${file}`)
    else if (now[file] !== sum) problems.push(`changed: ${file}`)
  }
  for (const file of Object.keys(now)) if (!(file in lock.files)) problems.push(`extra: ${file}`)
  if (problems.length > 0) {
    console.error(`duck/ differs from duck.lock.json (Doctor Duck ${lock.source.commit.slice(0, 7)}):\n${problems.join('\n')}`)
    process.exit(1)
  }
  console.log(`duck/ matches Doctor Duck ${lock.source.commit.slice(0, 7)} (${Object.keys(now).length} files)`)
}

function sync({ from, ref }) {
  const commit = git(from, 'rev-parse', '--verify', `${ref}^{commit}`)
  const committedAt = git(from, 'show', '-s', '--format=%cI', commit)
  const subject = git(from, 'show', '-s', '--format=%s', commit)
  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(TARGET, { recursive: true })
  const tar = execFileSync('git', ['-C', from, 'archive', '--format=tar', commit, '--', ...PATHS], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', TARGET], { input: tar })
  const files = hashTree(TARGET)
  const lock = {
    note: 'duck/ is a verbatim copy of these Doctor Duck paths at this commit. Re-run scripts/sync-duck.mjs instead of editing it.',
    source: { repository: 'JoeyWu-tech/Doctor-Duck', ref, commit, committedAt, subject },
    paths: PATHS,
    files,
  }
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`copied ${Object.keys(files).length} files from Doctor Duck ${commit.slice(0, 7)} (${ref}) into duck/`)
}

const options = args(process.argv.slice(2))
if (options.check) check()
else sync(options)
