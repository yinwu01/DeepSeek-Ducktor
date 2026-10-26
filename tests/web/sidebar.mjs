// The 鸭子 tab in a real `dsh web`, driven by headless Chromium. Sends no prompt.
//
//   node tests/web/sidebar.mjs <launch-url> <outprefix> <project-dir> [poll] [dark]
//
// Start `dsh web --no-open --host 127.0.0.1 --port <p>` in a dsh home whose web profile has this
// plugin, pass the tokenized URL it prints, and a project whose .duck/ has something in it (for
// example tests/fixtures/duck-files copied to <project>/.duck with 开关：on). The script registers
// the project as a workspace, opens a new Session there, opens the right sidebar and the 鸭子 tab,
// and saves screenshots and the panel text under <outprefix>. With `poll` it then appends a line
// to .duck/decisions.md and checks the open panel shows it within 15 seconds. Exit code 1 when a
// step fails.
//
// Needs playwright-core and a Chromium build (none are dependencies of this package):
//   PLAYWRIGHT_CORE  directory of an installed playwright-core package
//   CHROMIUM         Chromium or chrome-headless-shell executable
import { appendFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'

const { chromium } = createRequire(join(process.env.PLAYWRIGHT_CORE ?? '', 'package.json'))('playwright-core')
const [url, out, project, ...steps] = process.argv.slice(2)
const name = basename(project)
const log = []
const note = (...parts) => { const line = parts.join(' '); log.push(line); console.log(line) }
let failed = false

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: steps.includes('dark') ? 'dark' : 'light' })
page.on('pageerror', error => { failed = true; note('pageerror', String(error).slice(0, 300)) })
let shot = 0
const snap = async (label) => { const file = `${out}-${++shot}-${label}.png`; await page.screenshot({ path: file }); note('shot', file) }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  await page.evaluate(async (path) => (await fetch('/api/workspace/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'w1', method: 'workspace/create', payload: { args: { request: { path } } } }),
  })).text(), project)
  await page.waitForTimeout(2000)
  // A fresh home shows a one-time preview notice (information only) over the page.
  const notice = page.getByRole('button', { name: '继续', exact: true })
  if (await notice.count() > 0 && await notice.first().isVisible().catch(() => false)) {
    await notice.first().click()
    await page.waitForTimeout(800)
  }
  await page.getByText(name, { exact: true }).first().hover()
  await page.getByRole('button', { name: `在“${name}”中新建会话` }).click({ force: true })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '打开右侧边栏' }).click()
  await page.waitForTimeout(1500)
  await snap('guide')
  await page.getByText('鸭子', { exact: true }).first().click()
  await page.locator('.ds-supervisor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(3000)
  await snap('duck')
  note('panel', (await page.locator('.ds-supervisor').first().innerText()).replace(/\n+/g, ' / ').slice(0, 1500))
  // The host injects Doctor Duck's cards and the plugin's own mentor/cards into the page.
  const ids = await page.evaluate(() => (window.__DEEPSEEK_SUPERVISOR__?.cards ?? []).map(card => card.id))
  note('cards', ids.length, ids.join(' '))
  if (!ids.includes('W13') || !ids.includes('I02')) failed = true
  if (steps.includes('poll')) {
    appendFileSync(join(project, '.duck', 'decisions.md'), '- 2026-10-26 ▸ 决策：页签自动刷新测试（AI 定，待你确认）\n')
    const seen = await page.getByText('页签自动刷新测试').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
    note('poll', seen ? 'picked up' : 'NOT picked up')
    if (!seen) failed = true
    await snap('polled')
  }
  for (const summary of await page.locator('.ds-supervisor summary').all()) await summary.click()
  await page.locator('.ds-supervisor').evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(500)
  await snap('bottom')
} catch (error) {
  failed = true
  note('error', String(error?.stack ?? error).slice(0, 800))
} finally {
  writeFileSync(`${out}.log`, log.join('\n') + '\n')
  await browser.close()
}
process.exit(failed ? 1 : 0)
