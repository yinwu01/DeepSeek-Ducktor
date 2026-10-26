// tests/e2e/profile-row.cjs against the row shapes `dsh --dump-config` prints (0.2.1-rc.2).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, describe, test } from 'node:test'

const { rowCheckout, rowNames } = createRequire(import.meta.url)('./e2e/profile-row.cjs')

const dir = mkdtempSync(join(tmpdir(), 'ducktor-row-'))
after(() => rmSync(dir, { recursive: true, force: true }))

describe('rowNames', () => {
  test('a package row, a quoted row, and a folded file:// row; other ids are skipped', () => {
    const dump = [
      '- id: skill-filesystem',
      "  name: '@deepseek-ai/dsh-skill-filesystem'",
      '- id: deepseek-ducktor',
      '  name: deepseek-ducktor',
      '- id: deepseek-ducktor',
      "  name: 'file:///x/it''s/index.js'",
      '# == /home/u/.dsh/cordis.patch.yml',
      '- id: deepseek-ducktor',
      '  name: >-',
      '    file:///SSD1/a/very/long/parent/path/deepseek-ducktor/index.js',
      '  config:',
      '    subagents: true',
      '- id: other',
      '  name: x',
    ].join('\n')
    assert.deepEqual(rowNames(dump), [
      'deepseek-ducktor',
      "file:///x/it's/index.js",
      'file:///SSD1/a/very/long/parent/path/deepseek-ducktor/index.js',
    ])
  })
  test('nested rows inside a group are found; a row without a name is skipped', () => {
    const dump = ['- id: group', '  children:', '    - id: deepseek-ducktor', '      name: deepseek-ducktor', '- id: deepseek-ducktor', '  disabled: true'].join('\n')
    assert.deepEqual(rowNames(dump), ['deepseek-ducktor'])
  })
})

describe('rowCheckout', () => {
  test('percent-encoded file URLs (space, Chinese) resolve to the real checkout', () => {
    const checkout = join(dir, '路径 测试', 'ducktor')
    mkdirSync(checkout, { recursive: true })
    writeFileSync(join(checkout, 'index.js'), '')
    const url = pathToFileURL(join(checkout, 'index.js')).href
    assert.match(url, /%20/)
    assert.equal(rowCheckout(url, { dshHome: dir, profile: 'headless' }), checkout)
    assert.equal(rowCheckout(join(checkout, 'index.js'), { dshHome: dir, profile: 'headless' }), checkout)
  })
  test('a package row is the link in the profile node_modules; missing gives empty', () => {
    const modules = join(dir, 'profiles', 'headless', 'node_modules')
    mkdirSync(modules, { recursive: true })
    const checkout = join(dir, 'linked')
    mkdirSync(checkout)
    symlinkSync(checkout, join(modules, 'deepseek-ducktor'))
    assert.equal(rowCheckout('deepseek-ducktor', { dshHome: dir, profile: 'headless' }), checkout)
    assert.equal(rowCheckout('deepseek-ducktor', { dshHome: dir, profile: 'web' }), '')
    assert.equal(rowCheckout(undefined, { dshHome: dir, profile: 'web' }), '')
  })
})
