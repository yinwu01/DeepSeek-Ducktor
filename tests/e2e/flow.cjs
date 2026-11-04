#!/usr/bin/env node
// End-to-end run of a grad student's session with Ducktor in DeepSeek Harness, on a real
// DeepSeek model. Ported from Ducktor's tests/e2e/flow.js at the commit in duck.lock.json:
// the stages and checks are the same, plus a few for what only this plugin does (the context
// can carry the rules, .duck/background.md, the extra cards in mentor/ count as sources); what
// changed is how the host runs, how its output is read, and where the injected context is
// found. Code here is MIT. It costs real tokens.
//
//   node tests/e2e/flow.cjs          main flow: idle, menu, on, idea, review, propose, why,
//                                    quiet, card, learn, off
//   node tests/e2e/flow.cjs more     survey (then /duck-why on it), outline, intro, write,
//                                    figure, vibe and notes
//   node tests/e2e/flow.cjs loop     /duck picking a command, old notebook entries coming
//                                    back, a free conversation about a single-run result,
//                                    and 「这类我懂了」
//   node tests/e2e/flow.cjs paper    review, why and learn on a real paper: set
//                                    DUCK_E2E_PAPER to a folder with its LaTeX source
//
// Each turn is one `dsh --profile <profile> --json` run in the project directory, continued
// with --session-id, which is how dsh's headless mode does multi-turn work. The headless profile
// has no ask-user tool, so the model asks in text and the one follow-up answer below applies as
// for Claude Code and Codex. A tool call that needs approval (outside the sandbox) is refused,
// not left waiting: headless has no approver and dsh fails closed. Needs Node 22.15 or later
// (zstd in node:zlib) to read the session logs.
//
// Environment:
//   DEEPSEEK_API_KEY  required; read by dsh itself (nothing here touches it)
//   DSH               the dsh command (default: dsh on PATH)
//   DSH_HOME          dsh's home; the profile below must have deepseek-ducktor installed
//                     (dsh plugin --profile headless add <this checkout>) or a cordis.patch.yml row
//   DUCK_E2E_PROFILE  dsh profile (default: headless); it must take headless's --json and
//                     --session-id, so web or acp will not work here
//   DUCK_E2E_MODEL    model id for provider deepseek-official (default: the profile's own,
//                     deepseek-flash in dsh 0.2.1-rc.2); passed as a --patch overlay
//   DUCK_E2E_WRAP     command prefix for dsh, e.g. a network or capability wrapper
//   DUCK_E2E_ONLY     comma-separated stage names to run (later stages may depend on earlier ones)
//   DUCK_E2E_NOT_ON   1: the loop flow writes no .duck/config.md, so `DUCK_E2E_ONLY=route` checks
//                     `/duck <sentence>` in a project that has not turned Ducktor on
//   DUCK_E2E_PAPER    for the paper flow: a folder holding one paper's LaTeX source; it is copied
//                     to paper/ in an empty project
//
// The fixture project is copied to a temp folder. Each stage's event stream, summary.json,
// summary.md and a copy of the project's .duck/ land in evals/results/e2e-dsh-<flow>-<time>/.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readSessionEvents, sessionLogPath } = require('./session-log.cjs');
const { idRows, rowCheckout } = require('./profile-row.cjs');

const REPO = path.resolve(__dirname, '..', '..');
// Ducktor's own files (cards/ for the card-number checks) and the locked fixture.
const ROOT = process.env.DUCK_ROOT ? path.resolve(process.env.DUCK_ROOT) : path.join(REPO, 'duck');
const FIXTURE = path.join(__dirname, 'fixtures', 'grad-project');
const HOST = 'dsh';
const FLOW = process.argv[2] || 'main';
if (!['main', 'more', 'loop', 'paper'].includes(FLOW)) {
  console.error('usage: node tests/e2e/flow.cjs [main|more|loop|paper]');
  process.exit(2);
}
const DSH = process.env.DSH || 'dsh';
const PROFILE = process.env.DUCK_E2E_PROFILE || 'headless';
const MODEL = process.env.DUCK_E2E_MODEL || '';
const WRAP = (process.env.DUCK_E2E_WRAP || '').split(' ').filter(Boolean);
const ONLY = (process.env.DUCK_E2E_ONLY || '').split(',').filter(Boolean);
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(REPO, 'evals', 'results', `e2e-${HOST}-${FLOW}-${STAMP}`);
const PROJECT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ducktor-e2e-dsh-')), 'project');

// In dsh the commands keep Claude Code's short names.
const cmd = (name) => `/${name}`;

// ---------- running the host ----------

// A model override is one more patch layer over the profile (dsh 0.2.1-rc.2 has no --model).
const MODEL_PATCH = MODEL ? path.join(path.dirname(PROJECT), 'model.patch.yml') : '';
if (MODEL) {
  fs.writeFileSync(MODEL_PATCH, `- id: agent-default-model\n  name: '@deepseek-ai/dsh-agent-default-model'\n  config:\n    provider: deepseek-official\n    model: ${JSON.stringify(MODEL)}\n`);
}

// The shipped profiles read the sandbox mode from DSH_PERMISSION_MODE; pin the default so a
// caller's environment cannot turn every write check into a sandbox refusal.
const ENV = { ...process.env, DSH_PERMISSION_MODE: 'workspace-write' };
const host = (args, opts = {}) => spawnSync(WRAP[0] || DSH, [...WRAP.slice(1), ...(WRAP.length ? [DSH] : []), ...args],
  { cwd: PROJECT, env: ENV, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// opts.search is ignored: web search in dsh is a profile setting, not a per-run flag.
function runDsh(prompt, session, opts = {}) {
  return host(['--profile', PROFILE, ...(MODEL ? ['--patch', MODEL_PATCH] : []), '--json',
    ...(session ? ['--session-id', session] : []), prompt], { timeout: opts.timeout || 900000 });
}

// Normalizes one `--json` event stream into { session, reply, reads, tools, injected, cost,
// tokens, turnReason }. cost stays 0: dsh reports token usage, not money; tokens holds the
// step usage the stream reports (no compaction or title calls). The stream caps strings at
// 8 KiB, so turn() below replaces reply, tools and reads with the session log's copies.
function parse(stdout) {
  const t = { session: null, reply: '', reads: [], tools: [], injected: '', cost: 0, tokens: {}, errors: [], turnReason: null };
  const texts = [];
  for (const line of stdout.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch (err) { continue; }
    if (ev.type === 'session') t.session = ev.sessionId;
    if (ev.type === 'text' && ev.text.trim()) texts.push(ev.text);
    if (ev.type === 'tool_call') {
      const input = ev.input || {};
      const target = input.file_path || input.command || input.path || input.pattern || '';
      t.tools.push(`${ev.tool} ${target}`);
      // read is dsh's file tool; a shell command that prints a file counts too, as for Codex.
      if (ev.tool === 'read' || ev.tool === 'bash') t.reads.push(String(target));
    }
    if (ev.type === 'status' && ev.phase === 'step_end' && ev.usage) {
      for (const [k, v] of Object.entries(ev.usage)) if (typeof v === 'number') t.tokens[k] = (t.tokens[k] || 0) + v;
    }
    if (ev.type === 'status' && ev.phase === 'turn_end') t.turnReason = (ev.reason && ev.reason.kind) || null;
    if (ev.type === 'status' && ev.phase === 'turn_end' && ev.reason && ev.reason.kind !== 'completed') t.errors.push(JSON.stringify(ev.reason).slice(0, 300));
    if (ev.type === 'error') t.errors.push(JSON.stringify(ev).slice(0, 300));
    if (ev.type === 'final') t.session = ev.sessionId || t.session;
  }
  t.reply = texts.join('\n\n');
  return t;
}

// What one run added to the session, from dsh's own session log: the Ducktor context
// messages (the counterpart of a SessionStart hook's output), the assistant's text, the tool
// calls, and the model the requests were built for (dsh stamps the same name on the reply,
// so the log cannot show a different model answering). found is false when the log has no
// assistant output.
function sessionDelta(session, seenSeq) {
  const out = { found: false, injected: '', reply: '', tools: [], reads: [], requested: [], lastSeq: seenSeq };
  const file = session && sessionLogPath(DSH_HOME, session);
  if (!file) return out;
  const events = readSessionEvents(file);
  const texts = [];
  const injected = [];
  const requested = new Set();
  for (const e of events) {
    if (typeof e.seq !== 'number' || e.seq <= seenSeq) continue;
    out.lastSeq = Math.max(out.lastSeq, e.seq);
    const d = e.data || {};
    if (e.type === 'user/message' && d.source && d.source.kind === 'ducktor') injected.push(d.content.map((c) => c.text || '').join(''));
    // Recorded before the request is sent, so it is there even when nothing answered.
    if (e.type === 'request/header' && d.header && d.header.config && d.header.config.model) requested.add(d.header.config.model);
    if (e.type === 'assistant/message' && d.message) {
      out.found = true;
      for (const block of d.message.content || []) if (block.type === 'text' && block.text.trim()) texts.push(block.text);
    }
    if (e.type === 'tool/call') {
      out.found = true;
      let input = {};
      try { input = JSON.parse(d.arguments || '{}') || {}; } catch (err) { input = {}; }
      const target = input.file_path || input.command || input.path || input.pattern || '';
      out.tools.push(`${d.name} ${target}`);
      if (d.name === 'read' || d.name === 'bash') out.reads.push(String(target));
    }
  }
  out.injected = injected.join('\n');
  out.reply = texts.join('\n\n');
  out.requested = [...requested];
  return out;
}

// Last session-log seq read per session, so a run sees only what it added itself.
const seen = new Map();

// One student turn: run dsh, then take reply, tool calls and injected context from the
// session log. completed needs exit 0 and a completed final turn, as dsh's README asks.
function turn(prompt, sid, opts, file) {
  const run = runDsh(prompt, sid, opts);
  fs.writeFileSync(file, run.stdout || '');
  const t = parse(run.stdout || '');
  t.session = t.session || sid;
  const delta = sessionDelta(t.session, seen.get(t.session) ?? -1);
  if (t.session) seen.set(t.session, delta.lastSeq);
  t.injected = delta.injected;
  if (delta.found) Object.assign(t, { reply: delta.reply, tools: delta.tools, reads: delta.reads });
  t.requested = delta.requested;
  t.exit = run.status;
  if (run.error) t.errors.push(String(run.error.message || run.error));
  t.completed = !run.error && run.status === 0 && t.turnReason === 'completed';
  t.stderr = run.stderr || '';
  return t;
}

// ---------- checks ----------

const duckFile = (rel) => path.join(PROJECT, '.duck', rel);
const exists = (rel) => fs.existsSync(duckFile(rel));
const text = (rel) => (exists(rel) ? fs.readFileSync(duckFile(rel), 'utf8') : '');
const reports = (suffix) => (fs.existsSync(duckFile('reports'))
  ? fs.readdirSync(duckFile('reports')).filter((f) => f.endsWith(`${suffix}.md`) || f.includes(`${suffix}-`)) : []);
const allReports = () => (fs.existsSync(duckFile('reports')) ? fs.readdirSync(duckFile('reports')) : []);
// Read the original skill in this stage, or earlier in the same dsh session (its text is still in context).
const readOf = (t, skill) => [...t.reads, ...(t.earlierReads || [])].some((r) => r && r.includes(`library/${skill}/SKILL.md`));
const switchIs = (mode) => new RegExp(`^[\\s>*#-]*开关\\s*[:：]\\s*${mode}`, 'm').test(text('config.md'));
const FOLLOWUP = '信息就这些。按你的理解继续做完，缺的地方在结果里标出来就行；我前面说的限制照旧。';
const newestReport = (suffix) => {
  const f = reports(suffix).sort().at(-1);
  return f ? fs.readFileSync(duckFile(path.join('reports', f)), 'utf8') : '';
};
const fixture = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const projectFile = (rel) => (fs.existsSync(path.join(PROJECT, rel)) ? fs.readFileSync(path.join(PROJECT, rel), 'utf8') : '');
const notebookLines = () => text('notebook.md').split('\n').filter((l) => l.trim());
// Card numbers in lines that mention cards, or in the list under a 卡片提醒 heading
// (other lines may say P99 or similar).
const cardFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[A-Z]\d{2}\.md$/.test(f)).map((f) => f.slice(0, 3)) : []);
// Ducktor's cards and the ones deepseek-ducktor adds (mentor/cards).
const PLUGIN_CARDS = new Set([...cardFiles(path.join(ROOT, 'cards')), ...cardFiles(path.join(REPO, 'mentor', 'cards'))]);
const cardIds = (s) => {
  const lines = [];
  let inList = false;
  let seenItem = false;
  for (const l of s.split('\n')) {
    if (/卡片提醒/.test(l)) { inList = true; seenItem = false; lines.push(l); continue; }
    if (inList && !l.trim() && seenItem) inList = false;
    if (inList && l.trim()) seenItem = true;
    if (inList || /卡/.test(l)) lines.push(l);
  }
  // Only letters cards use (the plugin's prefixes and G for group cards), so a line reference
  // such as L14 in a review table that also names a card is not read as a card number.
  const letters = [...new Set([...PLUGIN_CARDS].map((id) => id[0]).concat('G'))].join('');
  return lines.flatMap((l) => [...l.matchAll(new RegExp(`\\b([${letters}]\\d{2})\\b`, 'g'))].map((m) => m[1]));
};
// A plugin card number standing on its own: a line that starts with it (「卡 E05 差距……」,
// 「E05：……」) or says little else. Cards are named by title or by what they say; the number
// may only follow in brackets, e.g. 「差距要大过种子间的波动（卡 E05）」.
const bareCardId = (s) => s.split('\n').some((l) => {
  if (![...PLUGIN_CARDS].some((id) => new RegExp(`\\b${id}\\b`).test(l))) return false;
  if (/^[\s>*\-•\d.、]*\**\s*(?:卡片?|card)?\s*[A-Z]\d{2}\b/i.test(l)) return true;
  const rest = l.replace(/(?:卡片?|card)?\s*\b[A-Z]\d{2}\b/gi, '').replace(/[\s>*\-•()（）,，:：;；.。、]/g, '');
  return rest.length < 6;
});
// The hook injected the not-turned-on note and not the resident rules. Matches idle.md's first
// words, which no command file contains (Codex's rollout also holds the command files it read).
const IDLE_ONLY = (t) => /Ducktor 没在这个项目开启：/.test(t.injected) && !/# Ducktor 常驻规则/.test(t.injected);
// Every file under .duck/ with its size, to see whether a turn wrote anything there.
const duckSnapshot = () => {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else out.push(`${path.relative(PROJECT, p)}:${fs.statSync(p).size}`);
    }
  };
  walk(path.join(PROJECT, '.duck'));
  return out.sort().join('\n');
};
// The duck's explanation (after a command, a step, or in /duck-why): the last run of > lines in
// the reply. A blank line inside the block does not end it; any other non-quote line does.
// Since Ducktor 0.2.1 it has no fixed parts (no all-bold principle line, no 下次 line, no
// closing sentence), so the check is that it is there and says something besides the decision line.
const lastWhy = (s) => {
  const blocks = [];
  let cur = [];
  for (const l of s.split('\n')) {
    if (/^[ \t]*>/.test(l)) cur.push(l);
    else if (!l.trim() && cur.length) continue;
    else if (cur.length) { blocks.push(cur.join('\n')); cur = []; }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks.at(-1) || '';
};
const quoteText = (b) => b.split('\n').map((l) => l.replace(/^[ \t]*>\s?/, '').trim()).filter((l) => l && !/^▸/.test(l)).join('\n');
// The explanation closes the reply: after the last quote block only a short question or a pointer
// to the report may follow (red team, 11-04: a quote inside the skill's own result also passed).
const afterLastQuote = (s) => {
  const lines = s.split('\n');
  let i = lines.length - 1;
  while (i >= 0 && !/^[ \t]*>/.test(lines[i])) i -= 1;
  return i < 0 ? s : lines.slice(i + 1).join('\n');
};
// Claude Code's web search tool makes the model end with a 「Sources:」 list; it is not part of
// what follows the explanation (rc4 more, stage survey).
const withoutSources = (s) => s.replace(/\n+(Sources|来源)[:：][ \t]*\n(?:[ \t]*[-*][^\n]*(?:\n|$))+\s*$/, '\n');
const WHY_BLOCK = { test: (s) => quoteText(lastWhy(s)).length > 0 && afterLastQuote(withoutSources(s)).replace(/\s/g, '').length <= 400 };
// The old fixed principle line: a quote line bold from end to end.
const BOLD_LINE = /^[ \t]*>\s*\*\*[^\n]+\*\*\s*$/m;
// A step of the wrapped skill given as the reason, e.g. 这是原技能 Step 0 的要求. Broad on purpose:
// it also catches a short why that only mentions the skill, so it stays a should.
const PROCEDURE_REASON = /原技能[^\n。]{0,24}(要求|规定|规则|说明|标准)|[按照依]原技能|技能(的)?要求|Step ?\d|SKILL\.md|references\/|\.md ?第 ?\d/;
// Saying where the duck departed from the skill is wanted: 原技能写 X，我降成 MAJOR，因为……
const DEPARTS = /我(降|改|没照|没按|放宽|收紧)|但我|不照/;
const procedureReason = (why) => why.split(/[。；\n]/).some((c) => PROCEDURE_REASON.test(c) && !DEPARTS.test(c));
const shortWhyChecks = () => [
  ['should', 'the short why gives a reason, not a step of the skill', (t) => lastWhy(t.reply) && !procedureReason(lastWhy(t.reply))],
  ['should', 'the short why has no labels like 为什么这么做：', (t) => lastWhy(t.reply) && !/^[ \t]*>\s*\**(为什么这么做|为什么|取舍|依据|你能带走的一条|下次自己先做什么|下次自己先做)\**[：:]/m.test(lastWhy(t.reply))],
  ['should', 'the short why has no all-bold principle line', (t) => lastWhy(t.reply) && !BOLD_LINE.test(lastWhy(t.reply))],
  // Names, titles and card numbers go to the report; the conversation turns them into experience.
  ['should', 'the short why names no researcher and no plugin card number', (t) => namesIn(lastWhy(t.reply)).length === 0 && !cardIds(lastWhy(t.reply)).some((id) => PLUGIN_CARDS.has(id))],
  ['must', 'every Latin name the short why reports as saying something is in the plugin or the project', (t) => unknownSpeakers(lastWhy(t.reply)).length === 0],
  // The short why is short, so any capitalized name in it is checked, not only in reported speech.
  ['should', 'every Latin name in the short why is in the plugin or the project', (t) => unknownSpeakers(lastWhy(t.reply), true).length === 0],
];
// What quiet must not show: the 下次 line or a decision line inside a quote.
// Since 0.2.1 the explanation has no fixed 下次 line, so quiet is checked for any quote line: the
// explanation and the decision line are the duck's quotes, and the skills' own results quote with
// code blocks or quotation marks (rules/wrapper-template.md, step 6).
const DUCK_QUOTE = /^[ \t]*>/m;
// The principle part of a notebook line: between the first ｜ and ｜这次 (or the end).
const principleOf = (l) => l.split('｜')[1] || l;
// 「最小测试」「小测试」are test runs, not a quiz.
const QUIZ = /考考你|(?<!最)小测(?!试)|测验|测一测|思考题|练习题|课后作业|留个作业|布置.{0,4}作业|给你打分|打几分|你的得分|成长档案/;
// /duck-why talks like a mentor and grounds the lesson in named researchers. Names and views may
// only come from the plugin's cards (MENTORS.md and mentor/cards included), handbook and original
// skills, or from the student's own project (paper authors, the survey report, background.md),
// not from what the duck wrote while explaining. In every sentence of the reply
// that reports what someone said or thinks, each Latin name must appear in one of those, so a
// made-up authority fails. Multi-word names must match in full.
const textUnder = (dir, ext, skip = () => false) => {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (skip(p)) continue;
      if (e.isDirectory()) { if (e.name !== '.git') walk(p); } else if (ext.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
};
// What the duck itself writes while explaining (why and learn reports, the notebook, decision
// lines) holds the same names as the reply, so it cannot count as a source.
const DUCK_OWN = (p) => /[\\/]\.duck[\\/](notebook|decisions)\.md$|[\\/]\.duck[\\/]reports[\\/][^\\/]*-(why|learn)(-\d+)?\.md$/.test(p);
const PLUGIN_TEXT = [...['cards', 'handbook', 'library'].map((d) => path.join(ROOT, d)), path.join(REPO, 'mentor')]
  .map((d) => textUnder(d, /\.(md|txt|json|ya?ml)$/)).join('\n');
const allowedText = () => `${PLUGIN_TEXT}\n${textUnder(PROJECT, /\.(md|tex|bib|py|txt)$/, DUCK_OWN)}`;
const NOT_PEOPLE = new Set(['Deep', 'Learning', 'Tuning', 'Playbook', 'Harvard', 'NeurIPS', 'CommKit', 'EECS', 'Comm', 'Lab', 'MIT', 'III']);
// Researchers the reply may name: full names and surnames from MENTORS.md and the cards' sources.
const MENTOR_NAMES = (() => {
  const names = new Set(['Guo']);
  const take = (cell) => {
    for (const m of cell.replace(/（[^）]*）/g, '').matchAll(/[A-Z][A-Za-zé'.-]+(?: [A-Z][A-Za-zé'.-]+)*/g)) {
      names.add(m[0]);
      const last = m[0].split(' ').pop();
      if (!NOT_PEOPLE.has(last)) names.add(last === 'III' ? m[0] : last);
    }
  };
  for (const line of fs.readFileSync(path.join(ROOT, 'cards', 'MENTORS.md'), 'utf8').split('\n')) {
    if (/^\| [^|-]/.test(line)) take(line.split('|')[1]);
  }
  for (const dir of [path.join(ROOT, 'cards'), path.join(REPO, 'mentor', 'cards')]) {
    for (const f of fs.readdirSync(dir).filter((x) => /^[A-Z]\d{2}\.md$/.test(x))) {
      const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/^sources: \[(.*)\]$/m);
      if (m) take(m[1]);
    }
  }
  for (const n of NOT_PEOPLE) names.delete(n);
  return names;
})();
// Researchers named in a text, by whole word. Surnames that are also English words or common
// Latin words (Might, Hill, Long) are left out, so 「might」 or 「Bradford Hill」 do not count.
const COMMON_WORDS = new Set(['Might', 'Hill', 'Long', 'Young', 'Wise', 'Rich', 'Brown', 'Gray', 'Green', 'White', 'Black', 'Rice', 'Love', 'Guo']);
const namesIn = (s) => [...MENTOR_NAMES].filter((n) => n.length > 2 && !COMMON_WORDS.has(n) && new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(s));
const SPEECH = /说|认为|主张|提醒|建议|强调|提出|指出|提到|写过|写道|讲过|讲的是|批评|觉得|看来|观点|看法/;
// The host and the plugin's own names are not authorities.
const HOSTS = new Set(['AI', 'Claude', 'Codex', 'GPT', 'ChatGPT', 'Doctor', 'Duck', 'Ducktor',
  'DeepSeek', 'DeepSeek Harness', 'Harness', 'DeepSeek-Ducktor']);
const unknownSpeakers = (reply, everySentence = false) => {
  const allowed = allowedText();
  const out = [];
  for (const sentence of reply.split(/[。；！？\n]/)) {
    if (!everySentence && !SPEECH.test(sentence)) continue;
    // Words ending in a lower-case letter: names, not acronyms like AC or KV.
    for (const m of sentence.matchAll(/[A-Z][A-Za-zé'.-]*[a-zé](?: [A-Z][A-Za-zé'.-]*[a-zé])*/g)) {
      if (!HOSTS.has(m[0]) && !allowed.includes(m[0])) out.push(m[0]);
    }
  }
  return out;
};
// Book and essay titles in 《》 must come from the same places; 施一公 was left out of MENTORS.md
// because his talk could not be read first-hand.
const unknownTitles = (reply) => {
  const allowed = allowedText();
  return [...reply.matchAll(/《([^》]+)》/g)].map((m) => m[1]).filter((t) => !allowed.includes(t)).concat(/施一公/.test(reply) ? ['施一公'] : []);
};
const OLD_OR_NEW_LABELS = /^[ \t]*>\s*\**(用的思路|要核对的话|放弃了什么|这次的过程|为什么|名家怎么看|回到这次|新手常怎么做|有经验的人怎么想|最值得学的|你能带走的一条|过程还原)\**[：:]/m;
// /duck-why since Ducktor 0.2.1: no fixed items or closing line in the conversation; the report
// carries the grounds and the line that the account is reconstructed from records.
const whyChecks = () => [
  ['must', 'wrote a why report', () => reports('why').length > 0],
  ['must', 'the reply carries the explanation, not only a pointer to the report', (t) => quoteText(lastWhy(t.reply)).replace(/\s/g, '').length > 40],
  ['must', 'the why report says the account is reconstructed from records', () => /看不出来|没法确认|无法确认|not in the records|can(no|')t (be )?(confirm|know)|no way to (know|confirm)/i.test(newestReport('why'))],
  ['should', 'the why report lists its grounds or says it is its own judgment', () => /依据|自己的判断|Grounds|Sources|own judgment/i.test(newestReport('why'))],
  ['should', 'no all-bold principle line', (t) => !BOLD_LINE.test(t.reply)],
  ['should', 'no fixed closing line about what cannot be confirmed', (t) => !/没法确认|AI 当时是不是这么想的/.test(t.reply)],
  ['should', 'no section labels like 用的思路： or 名家怎么看：', (t) => !OLD_OR_NEW_LABELS.test(t.reply)],
  ['should', 'names no researcher and no plugin card number in the conversation', (t) => namesIn(t.reply).length === 0 && !cardIds(t.reply).some((id) => PLUGIN_CARDS.has(id))],
  ['must', 'every Latin name it reports as saying something is in the plugin or the project', (t) => unknownSpeakers(t.reply).length === 0],
  ['should', 'every 《title》 it names is in the plugin or the project', (t) => unknownTitles(t.reply).length === 0],
];
// /duck-learn since Ducktor 0.2.1: it may ask one question about this stretch first (the stage's
// followup answers it); the conversation has no fixed headings, the report keeps five sections.
// The 「下一步」 (Next steps) section of a report: from that heading to the next heading.
// From the heading to the end of the report: the answer may get its own section after 下一步
// (rc4 main: 「## 学生的回看」 right after 「## 下一步」, with the next step in it).
const reportFrom = (text, heading) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^#+\s/.test(l) && heading.test(l));
  return at < 0 ? '' : lines.slice(at + 1).join('\n');
};
const reportSection = (text, heading) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^#+\s/.test(l) && heading.test(l));
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && /^#+\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
};
const learnChecks = (answerWords) => [
  ['must', 'wrote a learn report', () => reports('learn').length > 0],
  ['must', 'the reply carries the review itself, not only the report name', (t) => t.reply.replace(/\s/g, '').length > 200 && /AI ?定|交给 ?AI|下一步|接下来/.test(t.reply)],
  ['should', 'lists what was left to the AI', (t) => /交给 ?AI|AI ?定/.test(t.reply)],
  // Also inside the quote and with a full stop or colon inside the bold: 「> **本来想干什么。**」.
  ['should', 'no fixed bold headings in the conversation', (t) => !/^[\s>]*\*\*(本来想干什么|实际怎样|(顶级|有经验的)导师会盯哪里|(这次)?交给 ?AI 的判断|下一步|最要紧)/m.test(t.reply)],
  ['should', 'no fixed opening question', (t) => !/哪一步最想重来/.test(t.reply)],
  // The 我自己定 sentence is fixed text for the report; the conversation says it in its own words.
  ['should', 'the fixed 我自己定 sentence stays in the report', (t) => !/下次哪类事想自己定/.test(t.reply)],
  // The closing question is answered by the stage's answer; the answer goes into 下一步.
  ...(answerWords ? [['must', "the student's answer went into the report's next steps", (t) => !t.reply.includes('[学生]')
    || answerWords.test(reportFrom(newestReport('learn'), /下一步|Next steps/))]] : []),
  // The look-back comes first; one question on a concrete decision closes the last reply.
  // Judged on the first reply: after the stage's answer the conversation goes on (rc3 paper run).
  ['should', 'ends with one look-back question', (t) => /[？?][^？?]{0,40}$/.test(t.reply.split('\n\n[学生]')[0].trim())],
  ['should', 'names no researcher and no plugin card number in the conversation', (t) => namesIn(t.reply).length === 0 && !cardIds(t.reply).some((id) => PLUGIN_CARDS.has(id))],
  ['should', 'the report keeps the five sections', () => ['本来想干什么', '实际怎样', '会盯哪里', '交给 ?AI', '下一步'].every((k) => new RegExp(k).test(newestReport('learn')))],
  ['should', 'the report says how to record 我自己定', () => /我自己定/.test(newestReport('learn'))],
];

// Each stage: name, prompt, resume (continue the session), optional search and timeout, and
// checks. A check is [severity, label, fn(transcript, before)] where severity is must or should.
function stages() {
  return { main: mainStages, more: moreStages, loop: loopStages, paper: paperStages }[FLOW]();
}

function mainStages() {
  return [
    // A fresh project: the duck has not been turned on, so a free request gets no duck. Its own
    // session, so the later /duck on turn has no earlier edit to comment on.
    { name: 'idle', resume: false, prompt: '帮我把 paper/main.tex 摘要的最后一句改得更紧凑一点。先在对话里给，文件先别改。', checks: [
      ['must', 'hook injected the idle note, not the resident rules', (t) => IDLE_ONLY(t)],
      ['must', 'no .duck/ folder', () => !fs.existsSync(path.join(PROJECT, '.duck'))],
      ['must', 'no decision line', (t) => !/▸ ?决策/.test(t.reply)],
      ['should', 'does not bring up the duck', (t) => !/duck-|Ducktor|鸭子/i.test(t.reply)],
      ['should', 'paper/main.tex untouched', () => projectFile('paper/main.tex') === fixture('paper/main.tex')],
    ] },
    { name: 'menu', resume: false, prompt: cmd('duck'), checks: [
      ['must', 'menu lists the commands', (t) => /duck-review/.test(t.reply) && /duck-learn/.test(t.reply)],
      ['must', 'says the duck is not on in this project', (t) => /(没|未)[^\n]{0,8}开启|还没开|没在这个项目/.test(t.reply.replace(/\*/g, ''))],
      ['must', 'the menu did not turn it on', () => !switchIs('on')],
      ['must', 'hook injected the plugin root', (t) => /插件根目录/.test(t.injected)],
      ['should', 'no quack and no 鸭子: an advisor does not talk like that', (t) => !/quack|鸭子|嘎/i.test(t.reply)],
    ] },
    // Turning it on mid-session: the rules were not injected at session start, so the AI reads them
    // now. In dsh the next step after config.md changes also carries them (a replacement context),
    // so either one counts.
    { name: 'enable', resume: true, prompt: `${cmd('duck')} on`, checks: [
      ['must', 'config says on', () => switchIs('on')],
      ['must', 'read the resident rules this turn, or the context brought them', (t) => t.reads.some((r) => r && /rules\/core\.md|\.duck\/skills\/core\.md/.test(r))
        || /# Ducktor 常驻规则/.test(t.injected)],
      ['should', 'no quack and no 鸭子: an advisor does not talk like that', (t) => !/quack|鸭子|嘎/i.test(t.reply)],
    ] },
    { name: 'idea', resume: true, prompt: `${cmd('duck-idea')} 我想做长文本推理加速：用块均值估计注意力里每一对 64 token 的块贡献多大，贡献很小的整块跳过。目标是 7B 模型在 LongBench 上省 30% 以上时间、准确率不掉。对手是 token 级剪枝和稠密注意力。现有结果在 notes.md 里。`, checks: [
      ['must', 'read library/idea-evaluator', (t) => readOf(t, 'idea-evaluator')],
      ['must', 'wrote an idea report', () => reports('idea').length > 0],
      ['must', 'notebook got a line', () => /评估 idea|idea/.test(text('notebook.md'))],
      ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
      ...shortWhyChecks(),
    ] },
    { name: 'review', resume: true, prompt: `${cmd('duck-review')} paper/main.tex`, checks: [
      ['must', 'read library/pre-submission-reviewer', (t) => readOf(t, 'pre-submission-reviewer')],
      ['must', 'wrote a review report', () => reports('review').length > 0],
      ['must', 'caught the single-run claim', (t) => /seed|种子|单次|一次|方差|标准差/.test(t.reply)],
      ['should', 'caught the em-dash', (t) => /em-dash|破折号|em dash/i.test(t.reply)],
      ...shortWhyChecks(),
    ] },
    { name: 'propose', resume: true, prompt: '帮我把 paper/main.tex 摘要的第一句改得更紧凑一点。', before: () => text('notebook.md'), checks: [
      ['must', 'names /duck-polish in the reply', (t) => /duck-polish/.test(t.reply)],
      ['should', 'a one-sentence edit adds no notebook line', (t, before) => text('notebook.md') === before],
    ] },
    { name: 'why', resume: true, prompt: cmd('duck-why'), checks: whyChecks() },
    { name: 'quiet', resume: true, prompt: `${cmd('duck')} quiet`, checks: [
      ['must', 'config says quiet', () => switchIs('quiet')],
      // quiet still asks before research decisions (core rule 1 covers on and quiet). Off does stop
      // asking, so a line that names off does not count, nor does the line after it (a bullet's
      // text can start on the next line).
      ['should', 'does not say quiet stops asking first', (t) => {
        const lines = t.reply.split('\n');
        return !lines.some((l, i) => /不再先问|不先问了|不会先问/.test(l) && !/off/i.test(l) && !/off/i.test(lines[i - 1] || ''));
      }],
    ] },
    { name: 'polish-quiet', resume: true, prompt: `${cmd('duck-polish')} 润色 paper/main.tex 的摘要`, before: () => allReports().length, checks: [
      ['must', 'read library/paper-polish', (t) => readOf(t, 'paper-polish')],
      ['must', 'still wrote a report', (t, before) => allReports().length > before],
      ['must', 'no why part in the reply', (t) => !DUCK_QUOTE.test(t.reply)],
    ] },
    // Quiet, free conversation, a real method change: nothing said, one notebook line.
    { name: 'quiet-free', resume: true, prompt: '把 code/skip_attn.py 里跳过块的阈值从固定的 1e-3 改成每一层按块分数的 90% 分位数来定，其他你定，直接改代码。',
      before: () => notebookLines().length, checks: [
        ['must', 'nothing of the duck in the reply', (t) => !DUCK_QUOTE.test(t.reply) && !WHY_BLOCK.test(t.reply)],
        ['should', 'the notebook got one line about this step', (t, before) => notebookLines().length === before + 1 && /｜这次[:：]/.test(notebookLines().at(-1))],
      ] },
    { name: 'card-draft', resume: true, prompt: `${cmd('duck-skill')} card new 我们组规定：结果表里每个数都要写明跑了几个随机种子`, checks: [
      ['should', 'shows the card before writing it', () => !exists('cards/G01.md')],
    ] },
    { name: 'card-ok', resume: true, prompt: '可以，写吧。', checks: [
      ['must', 'wrote .duck/cards/G01.md', () => exists('cards/G01.md')],
      ['must', 'INDEX lists G01', () => /G01/.test(text('cards/INDEX.md'))],
    ] },
    { name: 'learn', resume: true, prompt: cmd('duck-learn'), answer: '补 seed 是我定的。回头看，最想重来的是摸方向，搜得太窄了。', checks: learnChecks(/摸方向|太窄|检索|搜/) },
    { name: 'off', resume: true, prompt: `${cmd('duck')} off`, checks: [
      ['must', 'config says off', () => switchIs('off')],
      // off is the fresh-install state, not a stronger "off" than that.
      ['should', 'reply says this is back to not turned on', (t) => /刚.{0,2}装好|没开启|未.{0,4}开启|没有开启/.test(t.reply)],
    ] },
    // A new session after /duck off: same as a project that never turned Ducktor on. The plugin
    // gives the idle note, and a command still explains itself and keeps its records.
    { name: 'off-new-session', resume: false, prompt: `${cmd('duck-polish')} 润色 paper/main.tex 的结论一节`,
      before: () => ({ reports: allReports().length }), checks: [
        ['must', 'injected the not-turned-on note', (t) => IDLE_ONLY(t)],
        ['must', 'wrote a polish report', (t, before) => allReports().length > before.reports],
        ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
      ] },
  ];
}

// The seven commands the main flow does not reach, in the order a student would meet them.
function moreStages() {
  const wrapped = (command, short, skill, prompt, extra = [], opts = {}) => ({ name: short, resume: true, prompt: `${cmd(command)} ${prompt}`, ...opts, checks: [
    ['must', `read library/${skill}`, (t) => readOf(t, skill)],
    ['must', `wrote a ${short} report`, () => reports(short).length > 0],
    ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
    ...shortWhyChecks(),
    // Since Ducktor 0.2.1 card reminders are in the report, not in the conversation.
    ['should', 'the report has card reminders with a plugin card number', (t) => /卡片提醒|Card reminders/.test(newestReport(short))
      && cardIds(newestReport(short)).some((id) => PLUGIN_CARDS.has(id))],
    ...extra,
  ] });
  const untouched = (rel) => ['should', `${rel} untouched`, () => projectFile(rel) === fixture(rel)];
  const notes = {};
  return [
    wrapped('duck-survey', 'survey', 'deep-research', '块稀疏注意力用于长文本推理加速。范围小一点：只看 2023 年以后，十篇以内，研究问题你来定两个。', [
      ['must', 'not turned on: hook injected the idle note', (t) => IDLE_ONLY(t)],
      ['should', 'cites checkable sources', (t) => /arxiv\.org|doi\.org|\b\d{4}\.\d{4,5}\b/i.test(t.reply + newestReport('survey'))],
      ['should', 'wrote .duck/background.md with links', () => /https?:\/\//.test(text('background.md'))],
    ], { search: true, timeout: 1800000 }),
    // The case students ask about most: what to learn from how the AI searched.
    { name: 'survey-why', resume: true, prompt: cmd('duck-why'), checks: whyChecks() },
    wrapped('duck-outline', 'outline', 'tech-paper-template', 'paper/main.tex', [
      ['should', 'says it uses the technical-paper template', (t) => /技术论文|tech-paper-template/.test(t.reply)],
    ]),
    wrapped('duck-intro', 'intro', 'intro-drafter', '按 paper/main.tex 的内容重写引言。先在对话里给草稿，paper/ 里的文件先别改。', [
      ['must', 'reminds the student to check facts, numbers and citations', (t) => /核对/.test(t.reply)],
      untouched('paper/main.tex'),
    ]),
    wrapped('duck-write', 'write', 'paper-writer', '写方法一节，依据 code/skip_attn.py 和 paper/main.tex。先在对话里给草稿，paper/ 里的文件先别改。', [
      ['must', 'reminds the student to check facts, numbers and citations', (t) => /核对/.test(t.reply)],
      ['should', 'notices the method text and the code disagree', (t) => /对不上|不一致|不符|矛盾|差异|差别|不是.{0,12}(注意力质量|attention mass)/.test(t.reply)],
      untouched('paper/main.tex'),
    ]),
    wrapped('duck-figure', 'figure', 'figure-designer', '给 notes.md 里的速度和准确率结果设计一张主图。'),
    wrapped('duck-vibe', 'vibe', 'vibe-research-workflow', '下周要在 LongBench 上把 BlockSkip 全量跑一遍、补三个随机种子，再写实验一节。哪些交给 AI 做、做到哪一步、哪些我自己把关？'),
    { name: 'notes', resume: true, prompt: cmd('duck-notes'), before: () => text('notebook.md'), checks: [
      ['must', 'lists every stage in the notebook', (t) => {
        const stagesInNotebook = [...new Set(notebookLines().map((l) => (l.match(/^- \d{2}-\d{2} (.+?)｜/) || [])[1]).filter(Boolean))];
        return stagesInNotebook.length > 0 && stagesInNotebook.every((st) => t.reply.includes(st));
      }],
      ['must', 'notebook untouched', (t, before) => text('notebook.md') === before],
    ] },
    { name: 'notes-delete', resume: true, prompt: `${cmd('duck-notes')} 删掉最后一条`,
      before: () => { notes.lines = notebookLines(); return text('notebook.md'); }, checks: [
        ['should', 'shows the change before writing', (t, before) => text('notebook.md') === before],
      ] },
    { name: 'notes-ok', resume: true, prompt: '可以，删吧。', checks: [
      ['must', 'the last line is gone and the rest kept', () => {
        const now = notebookLines();
        return notes.lines.length > 0 && now.length === notes.lines.length - 1 && now.every((l, i) => l === notes.lines[i]);
      }],
    ] },
    // Not turned on: 「这类我懂了」 is recorded all the same, without turning Ducktor on.
    { name: 'mute', resume: true, prompt: '多 seed 和方差这类我懂了，以后别讲了。', checks: [
      ['must', 'config mutes the category', () => /按类静音[\s\S]*(seed|种子|方差)/.test(text('config.md'))],
      ['must', 'did not turn Ducktor on', () => !switchIs('on') && !switchIs('quiet')],
      ['should', 'wrote no switch line', () => !/^[\s>*#-]*开关\s*[:：]/m.test(text('config.md'))],
    ] },
    // 「我自己定」 (new in 0.2.1): shown before it is recorded, recorded on a yes, and a command that
    // reaches that kind of decision asks first, even though Ducktor is not on here.
    { name: 'i-decide', resume: true, prompt: '以后引言里引哪些文献，我想自己定。', checks: [
      ['must', 'nothing recorded before the student agrees', () => !/我自己定[\s\S]*(文献|引用|引)/.test(text('config.md'))],
      ['should', 'shows the line it would record', (t) => /我自己定/.test(t.reply) && /文献|引用/.test(t.reply)],
      ['should', 'says that without Ducktor on it asks only when a command is typed', (t) => /敲.{0,12}命令|命令.{0,6}时/.test(t.reply)],
    ] },
    { name: 'i-decide-ok', resume: true, prompt: '可以，记吧。', checks: [
      ['must', 'config records the kind under 我自己定', () => /我自己定[\s\S]*(文献|引用|引)/.test(text('config.md'))],
      ['must', 'did not turn Ducktor on', () => !switchIs('on') && !switchIs('quiet')],
    ] },
    { name: 'i-decide-check', resume: true, prompt: `${cmd('duck-intro')} 把引言第二段的引用补全。先在对话里给草稿，paper/ 里的文件先别改。`,
      before: () => reports('intro').length, checks: [
        // A question can be a request too (rc3: 「第二段要引哪些，请你告诉我，二选一」 with no question mark).
        ['must', 'asks about the citations first and stops (a question, no new intro report)', (t, before) => /[？?]|请你?告诉我|二选一|你来定/.test(t.reply) && reports('intro').length === before],
      ] },
    // 「直接讲，别先问我」 is recorded as the 讲法 line and /duck-why explains right away.
    { name: 'explain-direct', resume: true, prompt: `${cmd('duck-why')} 直接讲，别先问我。`, before: () => reports('why').length, checks: [
      ['must', 'config records 讲法：直接讲', () => /讲法[^\n]*直接讲/.test(text('config.md'))],
      ['must', 'wrote a why report', (t, before) => reports('why').length > before],
      ['should', 'explains right away (the reply has the explanation block)', (t) => WHY_BLOCK.test(t.reply)],
    ] },
  ];
}

// What a student's notebook holds from earlier weeks when the loop flow starts.
const LOOP_NOTEBOOK = [
  '- 10-09 写摘要｜用词强度跟着证据走，只跑了一次的结果不写 significantly（卡 W11）',
  '- 10-12 写引言｜挑战段写问题本身为什么难，不写方法实现起来难（卡 W09）',
];

// The loop flow's .duck/config.md: the format /duck on writes (skills/duck/SKILL.md, section 二).
const LOOP_CONFIG = '# Ducktor 设定\n\n开关：on\n\n## 我自己定\n你说某类事以后想自己定时，Ducktor 在这里记一行，碰到这类事先问你。\n\n## 按类静音\n你说「这类我懂了」时，Ducktor 在这里记一行，以后这类只记不讲。\n\n## 静音的卡\n\n## 关掉的命令\n';

// The knowledge loop and the resident rules: /duck picks a command, old notebook entries come
// back in later commands, a free conversation about a single-run result, and 「这类我懂了」.
function loopStages() {
  const decisions = () => text('decisions.md').split('\n').filter((l) => l.trim());
  const withReport = (t, short) => t.reply + newestReport(short);
  return [
    { name: 'route', prompt: `${cmd('duck')} 帮我看看摘要最后一句是不是说得太满了`, checks: [
      ['must', 'names the command it picked', (t) => /duck-(polish|review)/.test(t.reply)],
      ['must', 'read the picked skill', (t) => readOf(t, 'paper-polish') || readOf(t, 'pre-submission-reviewer')],
      ['should', 'brings up the 10-09 notebook entry', (t) => /10-09/.test(withReport(t, 'polish') + newestReport('review'))],
    ] },
    { name: 'intro', resume: true, prompt: `${cmd('duck-intro')} 按 paper/main.tex 的内容重写引言。先在对话里给草稿，paper/ 里的文件先别改。`, checks: [
      ['must', 'read library/intro-drafter', (t) => readOf(t, 'intro-drafter')],
      ['must', 'brings up the 10-12 notebook entry', (t) => /10-12/.test(withReport(t, 'intro'))],
      ['must', 'notebook has no repeated principle', () => new Set(notebookLines().map(principleOf)).size === notebookLines().length],
      ['should', 'paper/main.tex untouched', () => projectFile('paper/main.tex') === fixture('paper/main.tex')],
    ] },
    { name: 'exp', resume: true, prompt: '新结果出来了：32k 长度上 BlockSkip 准确率 70.9，稠密注意力 70.6，只跑了一次。帮我把这一行加进 paper/main.tex 的表里。',
      before: () => projectFile('paper/main.tex'), checks: [
        ['must', 'raises seeds or run-to-run variation', (t) => /seed|种子|波动|方差|标准差/.test(t.reply)],
        ['should', 'asks before editing the table', (t, before) => /[？?]/.test(t.reply) && projectFile('paper/main.tex') === before],
        // Ducktor 11-03 probe A2: it stopped, but the question was only in decisions.md.
        ['must', 'when it stops before editing, the question is in the reply', (t, before) => projectFile('paper/main.tex') !== before || /[？?]/.test(t.reply)],
        ['should', 'no card number on its own in the reply', (t) => !bareCardId(t.reply)],
      ] },
    { name: 'exp-ok', resume: true, prompt: '先补到 3 个 seed，表等结果出来再改。', before: () => decisions().length, checks: [
      ['must', 'a new decision line says the student decided', (t, before) => decisions().slice(before).some((l) => /你定/.test(l))],
      ['should', 'reply shows the decision line', (t) => /▸ ?决策/.test(t.reply)],
    ] },
    // Everyday work, no command: core rule 6 reads the notebook before a stretch of work, so the
    // 10-09 entry (single runs are not written as significantly) should shape a results summary.
    { name: 'free-notebook', resume: true, prompt: '帮我给导师写一段这周的进展，就写 32k 上那个结果，三四句话，先在对话里给，不用改文件。', checks: [
      ['should', 'brings up the 10-09 notebook entry', (t) => /10-09|笔记本/.test(t.reply)],
      ['should', 'does not call the single run significantly better', (t) => !/significantly|显著(优于|提升|更好)/.test(t.reply.replace(/不(写|说|用)[^。\n]{0,12}(significantly|显著)/g, ''))],
    ] },
    { name: 'mute', resume: true, prompt: '多 seed 和方差这类我懂了，以后别讲了。', checks: [
      ['must', 'config mutes the category', () => /按类静音[\s\S]*(seed|种子|方差)/.test(text('config.md'))],
    ] },
    { name: 'mute-check', resume: true, prompt: '64k 长度上也出来了：BlockSkip 69.8，稠密 69.9，也只跑了一次。先记进 notes.md，表等补完 seed 再说。', checks: [
      ['should', 'notes.md got the 64k result', () => /64k/i.test(projectFile('notes.md'))],
      // A decision line (「> ▸ 决策：……表等 seed 补完再改」) is a record, not an explanation.
      ['should', 'does not explain seeds again', (t) => !/为什么[:：]/.test(t.reply) && !/波动/.test(t.reply) && !/^[ \t]*>(?![ \t]*▸)[^\n]*(seed|种子|方差)/im.test(t.reply)],
    ] },
  ];
}

// A real paper instead of the fixture: review it, ask why, then the stage review.
function paperStages() {
  const main = mainTex();
  return [
    { name: 'review', prompt: `${cmd('duck-review')} paper/${main}`, checks: [
      ['must', 'not turned on: hook injected the idle note', (t) => IDLE_ONLY(t)],
      ['must', 'read library/pre-submission-reviewer', (t) => readOf(t, 'pre-submission-reviewer')],
      ['must', 'wrote a review report', () => reports('review').length > 0],
      ['should', 'grades issues CRITICAL / MAJOR / MINOR', (t) => /CRITICAL|MAJOR|MINOR/.test(t.reply)],
      ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
      ...shortWhyChecks(),
    ] },
    { name: 'why', resume: true, prompt: cmd('duck-why'), checks: whyChecks() },
    { name: 'learn', resume: true, prompt: cmd('duck-learn'), answer: '审稿是我让做的，怎么审都交给你了。回头看，我最想先弄清审稿人最可能抓实验部分的哪一条。', checks: [
      // The answer names the experiments; the report's next steps should pick that up (the must in learnChecks).
      ...learnChecks(/实验|审稿人/),
    ] },
    // Not turned on: after the commands, a free request still gets no duck.
    { name: 'free', resume: true, prompt: `帮我把 paper/${main} 里摘要的第一句改得更紧凑一点（摘要在别的文件里就去那里找）。先在对话里给，文件先别改。`,
      before: () => duckSnapshot(), checks: [
        ['should', 'no decision line', (t) => !/▸ ?决策/.test(t.reply)],
        ['should', 'nothing new under .duck/', (t, before) => duckSnapshot() === before],
        ['should', 'does not point to a duck command', (t) => !/duck-/.test(t.reply)],
      ] },
  ];
}

// The paper flow's main .tex file: the one with \documentclass.
function mainTex() {
  const dir = path.join(PROJECT, 'paper');
  const tex = fs.readdirSync(dir).filter((f) => f.endsWith('.tex'));
  return tex.find((f) => /\\documentclass/.test(fs.readFileSync(path.join(dir, f), 'utf8'))) || tex[0];
}

function globalChecks(transcripts) {
  const notebook = text('notebook.md').split('\n').filter((l) => l.trim());
  return [
    ['must', 'notebook lines follow "- MM-DD 阶段｜原则（出处）"', () => notebook.length > 0 && notebook.every((l) => /^- \d{2}-\d{2} .+｜.+/.test(l))],
    ['must', 'decision lines read "- YYYY-MM-DD ▸ 决策：…"', () => !exists('decisions.md') || text('decisions.md').split('\n').filter((l) => l.trim()).every((l) => /^- \d{4}-\d{2}-\d{2} ▸ ?决策[:：]/.test(l))],
    ['should', 'new notebook lines say what happened this time (｜这次：)', () => { const fresh = notebook.filter((l) => !LOOP_NOTEBOOK.includes(l)); return (fresh.length > 0 || FLOW === 'loop') && fresh.every((l) => /｜这次[:：]/.test(l)); }],
    ['must', 'no bold marks in notebook lines', () => !/\*\*/.test(text('notebook.md'))],
    ['must', 'no em-dash in notebook or decisions', () => !/\u2014/.test(text('notebook.md') + text('decisions.md'))],
    // A decision line shown in a reply is written to decisions.md first (core rule 3; 11-04 trials:
    // three lines shown on day 2 never reached the file).
    ['should', 'every decision line shown in a reply is in decisions.md', () => {
      const norm = (s) => s.replace(/[\s:：,，。.()（）「」"'`*]/g, '');
      const log = norm(text('decisions.md'));
      return transcripts.every((t) => [...t.reply.matchAll(/▸ ?决策[:：]\s*([^\n]{6,})/g)].every((m) => log.includes(norm(m[1]).slice(0, 12))));
    }],
    // The short why names cards by title; a bare card number is jargon the student cannot read.
    ['should', 'no card number on its own in a short why', () => transcripts.map((t) => lastWhy(t.reply)).every((w) => !bareCardId(w))],
    // Most notebook lines are written by the AI; quoting one as the student's own is wrong.
    ['should', 'does not credit a notebook line to the student (你 MM-DD 记下的)', () => transcripts.every((t) => !/你 ?\d{2}-\d{2} ?记下的/.test(t.reply))],
    ['must', 'no quizzes, homework or scoring the student', () => transcripts.every((t) => !QUIZ.test(t.reply))],
    ['must', 'every card number the replies cite exists', () => {
      const group = fs.existsSync(duckFile('cards')) ? fs.readdirSync(duckFile('cards')).map((f) => f.slice(0, 3)) : [];
      return transcripts.every((t) => cardIds(t.reply).every((id) => PLUGIN_CARDS.has(id) || group.includes(id)));
    }],
  ];
}

// ---------- main ----------

function setup() {
  fs.mkdirSync(OUT, { recursive: true });
  if (FLOW === 'paper') {
    if (!process.env.DUCK_E2E_PAPER) { console.error('the paper flow needs DUCK_E2E_PAPER'); process.exit(2); }
    fs.cpSync(path.resolve(process.env.DUCK_E2E_PAPER), path.join(PROJECT, 'paper'), { recursive: true });
  } else {
    fs.cpSync(FIXTURE, PROJECT, { recursive: true });
  }
  const git = (...a) => spawnSync('git', a, { cwd: PROJECT });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=student', '-c', 'user.email=student@example.com', 'commit', '-q', '-m', '初稿和实验代码');
  // The loop flow tests the resident rules, so the student has turned the duck on; more and
  // paper leave it off, which is the commands-only path most projects take.
  if (FLOW === 'loop') {
    fs.mkdirSync(path.join(PROJECT, '.duck'), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, '.duck', 'notebook.md'), `${LOOP_NOTEBOOK.join('\n')}\n`);
    if (process.env.DUCK_E2E_NOT_ON !== '1') fs.writeFileSync(path.join(PROJECT, '.duck', 'config.md'), LOOP_CONFIG);
  }
  const install = `run: dsh plugin --profile ${PROFILE} add ${REPO}`;
  const refuse = (why, hint = install) => {
    console.error(`profile ${PROFILE} under ${DSH_HOME}: ${why}; ${hint}`);
    process.exit(2);
  };
  // The installed plugin must be this checkout, or the run tests something else. The last
  // deepseek-ducktor row wins: a package name (pnpm link in the profile) or a file.
  const row = idRows(host(['--profile', PROFILE, '--dump-config']).stdout || '').at(-1);
  if (!row) refuse('no deepseek-ducktor row');
  if (row.disabled === true) refuse(`the deepseek-ducktor row (${row.name}) is disabled`);
  const target = rowCheckout(row.name, { dshHome: DSH_HOME, profile: PROFILE });
  if (!target || target !== fs.realpathSync(REPO)) refuse(`does not load this checkout (row ${row.name} -> ${target || 'missing'})`);
  // The dump also lists a row dsh's compatibility check refuses to start. So, before any paid
  // request, one probe run whose model row names a provider with no adapter: dsh stops before
  // sending anything (even with a stored key), and by then the session log holds what the
  // first request would carry. It must hold this checkout's context and the /duck command.
  // (dsh's title model follows the request's route unless a patch names one for it.)
  const probePatch = path.join(path.dirname(PROJECT), 'probe.patch.yml');
  fs.writeFileSync(probePatch, "- id: agent-default-model\n  name: '@deepseek-ai/dsh-agent-default-model'\n  config:\n    provider: deepseek-ducktor-probe-no-adapter\n    model: none\n");
  const probe = parse(host(['--profile', PROFILE, '--patch', probePatch, '--json', '/duck 菜单'], { timeout: 120000 }).stdout || '');
  const file = probe.session && sessionLogPath(DSH_HOME, probe.session);
  const events = file ? readSessionEvents(file) : [];
  const sources = events.filter((e) => e.type === 'user/message').map((e) => (e.data && e.data.source) || {});
  const context = sources.find((s) => s.kind === 'ducktor');
  if (events.some((e) => e.type === 'assistant/message')) refuse('the probe run got a model reply; it must not reach a model');
  if (!context) refuse(`the plugin did not start: the probe session (${probe.session || 'none'}) has no Ducktor context`,
    `dsh may have refused it as incompatible (package.json engines.dsh against dsh --version), or apply() failed; ${install}`);
  if (!sources.some((s) => s.kind === 'skill-invocation' && s.name === 'duck')) refuse('the probe session has no /duck command');
  if (fs.realpathSync(context.root) !== fs.realpathSync(ROOT)) refuse(`the plugin reads Ducktor at ${context.root}, the checks expect ${ROOT}`);
}

// The plugin's commit and whether tracked files differ from it: taken when the run starts and when it
// ends, so a run whose plugin files changed halfway is marked (red team, 11-04: one main run
// started on one commit and finished on another).
const gitState = () => ({
  commit: spawnSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  dirty: spawnSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim() !== '',
});

function main() {
  const startState = gitState();
  setup();
  const results = [];
  const transcripts = [];
  let session = null;
  let stopped = null;
  for (const stage of stages()) {
    if (ONLY.length && !ONLY.includes(stage.name)) continue;
    const before = stage.before ? stage.before() : undefined;
    const started = Date.now();
    const opts = { search: stage.search, timeout: stage.timeout };
    const file = (suffix) => path.join(OUT, `${String(results.length + 1).padStart(2, '0')}-${stage.name}${suffix}.jsonl`);
    let t = turn(stage.prompt, stage.resume ? session : null, opts, file(''));
    if (stage.resume !== false && !session) session = t.session;
    if (stage.resume === false) session = t.session;
    t.sessionId = session;
    t.earlierReads = transcripts.filter((x) => x.sessionId && x.sessionId === session).flatMap((x) => x.reads);
    const evaluate = (tr) => stage.checks.map(([severity, label, fn]) => {
      let ok = false;
      try { ok = Boolean(fn(tr, before)); } catch (err) { ok = false; }
      return { severity, label, ok };
    });
    let checks = evaluate(t);
    // The original skills and core rule 1 sometimes stop to ask for missing details, and
    // the questions are not always the last line. Answer once, the way a student would,
    // and check again; the summary records that it happened.
    let followup = false;
    // A stage with an answer (the learn steps) also answers a closing question when nothing failed.
    const closingQuestion = /[？?][^？?]{0,60}$/.test(t.reply.trim());
    if (t.completed && ((checks.some((c) => !c.ok && c.severity === 'must') && /[？?]|你希望|请选择|请确认|选哪/.test(t.reply)) || (stage.answer && closingQuestion))) {
      followup = true;
      const answer = stage.answer || stage.followup || FOLLOWUP;
      const t2 = turn(answer, session, opts, file('-followup'));
      const tokens = { ...t.tokens };
      for (const [k, v] of Object.entries(t2.tokens)) tokens[k] = (tokens[k] || 0) + v;
      // The stage ran (its first run completed); a failed follow-up is one more failure, not
      // a reason to call the whole stage not run.
      t = { ...t, reads: [...t.reads, ...t2.reads], tools: [...t.tools, ...t2.tools], injected: `${t.injected}\n${t2.injected}`,
        errors: [...t.errors, ...t2.errors], reply: `${t.reply}\n\n[学生] ${answer}\n\n${t2.reply}`, cost: t.cost + t2.cost, tokens,
        requested: [...new Set([...t.requested, ...t2.requested])],
        followupExit: t2.exit, followupCompleted: t2.completed, followupStderr: t2.stderr };
      checks = evaluate(t);
      if (!t2.completed) checks.push({ severity: 'must', label: `the follow-up answer run completed (exit ${t2.exit}, turn ${t2.turnReason || 'did not end'})`, ok: false });
    }
    // No key, an unknown model, a timeout or a dead network: the stage did not run, so its
    // checks say nothing (an empty reply passes every "does not say" check). Record one
    // failure and stop, since later stages continue this session.
    const dead = !t.completed;
    // A follow-up that did not complete leaves the stage scored, but the session it shares
    // with later stages is in an unknown state: stop there too.
    const halted = dead || (followup && !t.followupCompleted);
    if (dead) checks = [{ severity: 'must', label: `the dsh run completed (exit ${t.exit}, turn ${t.turnReason || 'did not end'})`, ok: false }];
    transcripts.push(t);
    results.push({ stage: stage.name, prompt: stage.prompt, seconds: Math.round((Date.now() - started) / 1000),
      exit: t.exit, ...(followup ? { followup_exit: t.followupExit } : {}), models_requested: t.requested, tokens: t.tokens, followup, tools: t.tools, errors: t.errors, checks, reply: t.reply });
    const mark = dead ? 'STOP' : checks.every((c) => c.ok) ? 'ok  ' : (checks.some((c) => !c.ok && c.severity === 'must') ? 'FAIL' : 'warn');
    console.log(`${mark} ${stage.name} (${results.at(-1).seconds}s)${followup ? ' after one follow-up answer' : ''}`);
    for (const c of checks.filter((x) => !x.ok)) console.log(`       ${c.severity}: ${c.label}`);
    if (halted) {
      stopped = stage.name;
      const stderr = dead ? t.stderr : t.followupStderr;
      console.error(`stopped at ${stage.name}${dead ? '' : ' (follow-up)'}: ${t.errors[0] || 'no error event'}\n${stderr.trim().slice(0, 600)}\n`
        + `(session ${t.session || 'none'}; this run added ${t.injected.length} chars of Ducktor context)`);
      break;
    }
  }
  const global = stopped ? [{ severity: 'must', label: `the run reached every stage (stopped at ${stopped})`, ok: false }] : globalChecks(transcripts).map(([severity, label, fn]) => {
    let ok = false;
    try { ok = Boolean(fn()); } catch (err) { ok = false; }
    return { severity, label, ok };
  });
  for (const c of global.filter((x) => !x.ok)) console.log(`FAIL global ${c.severity}: ${c.label}`);
  const all = [...results.flatMap((r) => r.checks), ...global];
  const tokens = {};
  for (const r of results) for (const [k, v] of Object.entries(r.tokens || {})) tokens[k] = (tokens[k] || 0) + v;
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'duck.lock.json'), 'utf8'));
  const version = host(['--version']);
  const endState = gitState();
  const summary = {
    host: HOST, dsh: (version.stdout || '').trim(), profile: PROFILE, flow: FLOW, model: MODEL || '(profile default)',
    models_requested: [...new Set(results.flatMap((r) => r.models_requested || []))],
    commit: startState.commit, start: startState, end: endState,
    plugin_changed_during_run: startState.commit !== endState.commit || startState.dirty || endState.dirty,
    duck: process.env.DUCK_ROOT ? ROOT : lock.source.commit.slice(0, 7),
    when: new Date().toISOString(), tokens,
    must_failed: all.filter((c) => !c.ok && c.severity === 'must').length,
    should_failed: all.filter((c) => !c.ok && c.severity === 'should').length,
    passed: all.filter((c) => c.ok).length, total: all.length, stages: results, global,
  };
  if (fs.existsSync(path.join(PROJECT, '.duck'))) fs.cpSync(path.join(PROJECT, '.duck'), path.join(OUT, 'duck-files'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [`# e2e ${HOST} ${summary.dsh} ${FLOW} ${summary.commit}, Ducktor ${summary.duck} (${summary.model})`, '',
    ...(summary.plugin_changed_during_run ? [`**The plugin's files changed during this run** (start ${startState.commit}${startState.dirty ? ' with uncommitted changes' : ''}, end ${endState.commit}${endState.dirty ? ' with uncommitted changes' : ''}): the result belongs to no single commit.`, ''] : []),
    `${summary.passed}/${summary.total} checks passed; must failed ${summary.must_failed}, should failed ${summary.should_failed}`, '',
    `Model requested: ${summary.models_requested.join(', ') || 'none'}. Tokens reported in the --json stream (agent steps only): ${JSON.stringify(tokens)}`, ''];
  for (const r of results) {
    md.push(`## ${r.stage}: \`${r.prompt}\` (${r.seconds}s${r.followup ? ', one follow-up answer' : ''})`, '');
    for (const c of r.checks) md.push(`- [${c.ok ? 'x' : ' '}] ${c.severity}: ${c.label}`);
    md.push('', '<details><summary>reply</summary>', '', r.reply.trim(), '', '</details>', '');
  }
  md.push('## global', '', ...global.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.severity}: ${c.label}`), '');
  fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n'));
  console.log(`\n${summary.passed}/${summary.total} checks passed, must failed ${summary.must_failed}. ${path.relative(REPO, OUT)}/summary.md`);
  process.exit(summary.must_failed ? 1 : 0);
}

main();
