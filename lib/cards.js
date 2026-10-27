/**
 * The experience cards, read on the Host and handed to the Ducktor sidebar tab. Card files share
 * Ducktor's format (duck/cards/E02.md): YAML-ish front matter, then 「标签：文字」 lines with
 * optional `- ` items under them, then an 出处 list of 「- 名字：URL」.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_FILE = /^[A-Z]+\d+\.md$/
const LABELED = /^([^：:\s][^：]{0,15})：(.*)$/
const SOURCE_LINE = /^-\s*(.+?)：\s*(https?:\/\/\S+)\s*$/

/**
 * Read every card file of the given directories; later directories win on the same id.
 * @param {readonly string[]} dirs - card directories, lowest precedence first; missing ones are skipped.
 * @returns {object[]} cards sorted by id.
 */
export function readCards(dirs) {
  const byId = new Map()
  for (const dir of dirs) {
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names.filter(name => CARD_FILE.test(name)).sort()) {
      const file = join(dir, name)
      const card = parseCard(readFileSync(file, 'utf8'), file)
      if (card !== undefined) byId.set(card.id, card)
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Parse one card file.
 * @param {string} text - the file's text.
 * @param {string} file - its path, carried along for display.
 * @returns {object | undefined} the card, or undefined when the front matter has no id or title.
 */
export function parseCard(text, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return undefined
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (field !== null) meta[field[1]] = field[2].trim()
  }
  if (!meta.id || !meta.title) return undefined
  const parts = []
  const links = []
  let inSources = false
  for (const raw of match[2].split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (/^出处/.test(line)) {
      inSources = true
      continue
    }
    if (inSources) {
      const source = SOURCE_LINE.exec(line)
      if (source !== null) links.push({ label: source[1], url: source[2] })
      continue
    }
    if (line.startsWith('- ')) {
      if (parts.length === 0) parts.push({ label: '', text: '', items: [] })
      parts[parts.length - 1].items.push(line.slice(2))
      continue
    }
    const labeled = LABELED.exec(line)
    if (labeled !== null) parts.push({ label: labeled[1], text: labeled[2], items: [] })
    else parts.push({ label: '', text: line, items: [] })
  }
  return {
    id: meta.id,
    title: meta.title,
    when: meta.when ?? '',
    strength: meta.strength ?? '',
    parts,
    links,
    file,
  }
}
