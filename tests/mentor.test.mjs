// mentor/cards: the experience cards this package adds to Ducktor's. Same shape as
// duck/cards, ids that never collide with them, an index that matches the files, and the
// host note that points the model at them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { parseCard, readCards } from '../lib/cards.js'
import { hostNote, MENTOR_CARDS, PACKAGED_ROOT } from '../lib/duck.js'
import { mentorIndex } from '../scripts/mentor-index.mjs'

const files = readdirSync(MENTOR_CARDS).filter(name => /^[A-Z]\d{2}\.md$/.test(name)).sort()
const mentor = readCards([MENTOR_CARDS])
const duck = readCards([join(PACKAGED_ROOT, 'cards')])

describe('mentor cards', () => {
  test('there are some, and each file parses with its own id', () => {
    assert.ok(files.length > 0)
    for (const name of files) {
      const card = parseCard(readFileSync(join(MENTOR_CARDS, name), 'utf8'), name)
      assert.ok(card, name)
      assert.equal(`${card.id}.md`, name)
    }
  })
  test('no id is also a Ducktor card, and no letter the e2e checker reads as a line number', () => {
    const duckIds = new Set(duck.map(card => card.id))
    for (const card of mentor) {
      assert.ok(!duckIds.has(card.id), `${card.id} is also in duck/cards`)
      // L14-style line references in review tables; G is for the student's group cards.
      assert.ok(!/^[LG]/.test(card.id), card.id)
    }
  })
  test('front matter, sections and sources follow duck/cards', () => {
    for (const name of files) {
      const text = readFileSync(join(MENTOR_CARDS, name), 'utf8')
      const card = parseCard(text, name)
      assert.ok(['共识', '有出处', '有分歧'].includes(card.strength), `${name}: strength ${card.strength}`)
      assert.ok(card.when, `${name}: when`)
      assert.match(text, /^verified: \d{4}-\d{2}-\d{2}$/m, name)
      assert.match(text, /^sources: \[.+\]$/m, name)
      const labels = card.parts.map(part => part.label)
      if (card.strength === '有分歧') {
        for (const label of ['一派', '另一派', '怎么选']) assert.ok(labels.includes(label), `${name}: ${label}`)
      } else {
        for (const label of ['道理', '怎么用']) assert.ok(labels.includes(label), `${name}: ${label}`)
      }
      assert.match(text, /出处（都是我们自己的话转述，没有照抄原文）：/, name)
      assert.ok(card.links.length > 0, `${name}: no source links`)
      if (card.strength === '共识') assert.ok(card.links.length >= 3, `${name}: 共识 needs three sources`)
      assert.doesNotMatch(text, /—/, `${name}: em-dash`)
    }
  })
  test('INDEX.md matches the cards (node scripts/mentor-index.mjs rewrites it)', () => {
    assert.equal(readFileSync(join(MENTOR_CARDS, 'INDEX.md'), 'utf8'), mentorIndex(mentor))
  })
  test('the host note names the index, and asks for links and a background file', () => {
    const note = hostNote('/p')
    assert.ok(note.includes(join(MENTOR_CARDS, 'INDEX.md')))
    assert.match(note, /DOI、arXiv/)
    assert.ok(note.includes('/p/.duck/background.md'))
    assert.doesNotMatch(note, /—/)
  })
})
