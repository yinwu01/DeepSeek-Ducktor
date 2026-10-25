// Static checks on what `dsh plugin add` and a cordis.patch.yml row will read.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))

test('duck/ is exactly the locked Doctor Duck commit', () => {
  execFileSync(process.execPath, [join(HERE, 'scripts', 'sync-duck.mjs'), '--check'], { stdio: 'pipe' })
})

test('bundle manifest: patch, engine range, ESM, peers dsh provides', () => {
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(pkg.engines.dsh, /^>=0\.2\.1-rc\.2 /u)
  for (const peer of ['@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-llm', '@deepseek-ai/schemastery']) {
    assert.ok(pkg.peerDependencies[peer], peer)
  }
  assert.equal(pkg.dependencies, undefined, 'no dependencies: pnpm links the checkout without installing anything')
})

test('the patch inserts one Host row named after the package', () => {
  const patch = readFileSync(join(HERE, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^- insert:\n {4}- id: deepseek-ducktor\n {6}name: deepseek-ducktor\n$/mu)
  assert.equal(pkg.name, 'deepseek-ducktor')
})

test('published files cover everything loaded at run time', () => {
  for (const entry of ['index.js', 'lib/', 'cordis.patch.yml', 'locale/*.json', 'icon.png', 'duck/', 'duck.lock.json']) {
    assert.ok(pkg.files.includes(entry), entry)
  }
  assert.equal(JSON.parse(readFileSync(join(HERE, 'duck', 'package.json'), 'utf8')).type, undefined,
    'duck/package.json keeps duck/bin/duck.js CommonJS inside this ESM package')
})

test('display metadata: titles, descriptions, detail documents, a PNG icon under 256 KiB', () => {
  for (const locale of ['en', 'zh']) {
    const { meta } = JSON.parse(readFileSync(join(HERE, 'locale', `${locale}.json`), 'utf8'))
    assert.ok(meta.title && meta.description, locale)
  }
  // The Plugins page reads meta.detail from a subdirectory listed in files right after locale.
  for (const locale of ['en', 'zh']) {
    const { detail } = JSON.parse(readFileSync(join(HERE, 'locale', `${locale}.json`), 'utf8')).meta
    assert.match(detail, /^docs\/[^/]+\.md$/u, locale)
    assert.ok(existsSync(join(HERE, detail)), detail)
  }
  assert.equal(pkg.files[pkg.files.indexOf('locale/*.json') + 1], 'docs/')
  const icon = join(HERE, pkg.exports['./icon'])
  assert.ok(statSync(icon).size <= 256 * 1024)
  assert.deepEqual([...readFileSync(icon).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
})

test('adapter text has no em-dash', () => {
  for (const file of ['README.md', 'lib/duck.js', 'locale/zh.json', 'locale/en.json', 'docs/DETAIL.zh.md', 'docs/DETAIL.md', 'docs/验证记录.md']) {
    const path = join(HERE, file)
    if (!existsSync(path)) continue
    assert.doesNotMatch(readFileSync(path, 'utf8'), /[—―]/u, file)
  }
})
