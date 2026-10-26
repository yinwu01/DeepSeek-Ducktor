#!/usr/bin/env node
// End-to-end run of a grad student's session with Doctor Duck in DeepSeek Harness, on a real
// DeepSeek model. Ported from Doctor Duck's tests/e2e/flow.js at the commit in duck.lock.json:
// the stages and checks are the same; what changed is how the host runs, how its output is
// read, and where the injected context is found. Code here is MIT. It costs real tokens.
//
//   node tests/e2e/flow.cjs          main flow: idle, menu, on, idea, review, propose, why,
//                                    quiet, card, learn, off
//   node tests/e2e/flow.cjs more     survey, outline, intro, write, figure, vibe and notes
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

const REPO = path.resolve(__dirname, '..', '..');
// Doctor Duck's own files (cards/ for the card-number checks) and the locked fixture.
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
const PROJECT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-duck-e2e-dsh-')), 'project');

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

// What one run added to the session, from dsh's own session log: the Doctor Duck context
// messages (the counterpart of a SessionStart hook's output), the assistant's text, the tool
// calls, and the models that answered. found is false when the log has no assistant output.
function sessionDelta(session, seenSeq) {
  const out = { found: false, injected: '', reply: '', tools: [], reads: [], models: [], lastSeq: seenSeq };
  const file = session && sessionLogPath(DSH_HOME, session);
  if (!file) return out;
  const events = readSessionEvents(file);
  const texts = [];
  const injected = [];
  const models = new Set();
  for (const e of events) {
    if (typeof e.seq !== 'number' || e.seq <= seenSeq) continue;
    out.lastSeq = Math.max(out.lastSeq, e.seq);
    const d = e.data || {};
    if (e.type === 'user/message' && d.source && d.source.kind === 'doctor-duck') injected.push(d.content.map((c) => c.text || '').join(''));
    // The model each request was built for, recorded before it is sent.
    if (e.type === 'request/header' && d.header && d.header.config && d.header.config.model) models.add(d.header.config.model);
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
  out.models = [...models];
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
  t.models = delta.models;
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
const readOf = (t, skill) => t.reads.some((r) => r && r.includes(`library/${skill}/SKILL.md`));
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
const PLUGIN_CARDS = new Set(fs.readdirSync(path.join(ROOT, 'cards')).filter((f) => /^[A-Z]\d{2}\.md$/.test(f)).map((f) => f.slice(0, 3)));
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
// The hook injected the not-turned-on note and not the resident rules. Matches idle.md's first
// words, which no command file contains (Codex's rollout also holds the command files it read).
const IDLE_ONLY = (t) => /Doctor Duck 没在这个项目开启：/.test(t.injected) && !/# Doctor Duck 常驻规则/.test(t.injected);
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
// The short why after a command: a quote line that is bold from end to end, and a quote line
// starting with 下次. The original skills quote sentences too, so neither alone is enough.
const WHY_BLOCK = { test: (s) => /^[ \t]*>\s*\*\*[^\n]+\*\*\s*$/m.test(s) && /^[ \t]*>\s*下次/m.test(s) };
// What quiet must not show: the 下次 line or a decision line inside a quote.
const DUCK_QUOTE = /^[ \t]*>\s*(下次|▸ ?决策)/m;
// The principle part of a notebook line: between the first ｜ and ｜这次 (or the end).
const principleOf = (l) => l.split('｜')[1] || l;
// 「最小测试」is a minimal test run, not a quiz.
const QUIZ = /考考你|(?<!最)小测|测验|测一测|思考题|练习题|课后作业|留个作业|布置.{0,4}作业|给你打分|打几分|你的得分|成长档案/;

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
      ['should', 'does not bring up the duck', (t) => !/duck-|Doctor Duck|鸭子/i.test(t.reply)],
      ['should', 'paper/main.tex untouched', () => projectFile('paper/main.tex') === fixture('paper/main.tex')],
    ] },
    { name: 'menu', resume: false, prompt: cmd('duck'), checks: [
      ['must', 'menu lists the commands', (t) => /duck-review/.test(t.reply) && /duck-learn/.test(t.reply)],
      ['must', 'says the duck is not on in this project', (t) => /(没|未)[^\n]{0,8}开启|还没开|没在这个项目/.test(t.reply.replace(/\*/g, ''))],
      ['must', 'the menu did not turn it on', () => !switchIs('on')],
      ['must', 'hook injected the plugin root', (t) => /插件根目录/.test(t.injected)],
    ] },
    // Turning it on mid-session: the rules were not injected at session start, so the AI reads them
    // now. In dsh the next step after config.md changes also carries them (a replacement context),
    // so either one counts.
    { name: 'enable', resume: true, prompt: `${cmd('duck')} on`, checks: [
      ['must', 'config says on', () => switchIs('on')],
      ['must', 'read the resident rules this turn, or the context brought them', (t) => t.reads.some((r) => r && /rules\/core\.md|\.duck\/skills\/core\.md/.test(r))
        || /# Doctor Duck 常驻规则/.test(t.injected)],
    ] },
    { name: 'idea', resume: true, prompt: `${cmd('duck-idea')} 我想做长文本推理加速：用块均值估计注意力里每一对 64 token 的块贡献多大，贡献很小的整块跳过。目标是 7B 模型在 LongBench 上省 30% 以上时间、准确率不掉。对手是 token 级剪枝和稠密注意力。现有结果在 notes.md 里。`, checks: [
      ['must', 'read library/idea-evaluator', (t) => readOf(t, 'idea-evaluator')],
      ['must', 'wrote an idea report', () => reports('idea').length > 0],
      ['must', 'notebook got a line', () => /评估 idea|idea/.test(text('notebook.md'))],
      ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
    ] },
    { name: 'review', resume: true, prompt: `${cmd('duck-review')} paper/main.tex`, checks: [
      ['must', 'read library/pre-submission-reviewer', (t) => readOf(t, 'pre-submission-reviewer')],
      ['must', 'wrote a review report', () => reports('review').length > 0],
      ['must', 'caught the single-run claim', (t) => /seed|种子|单次|一次|方差|标准差/.test(t.reply)],
      ['should', 'caught the em-dash', (t) => /em-dash|破折号|em dash/i.test(t.reply)],
    ] },
    { name: 'propose', resume: true, prompt: '帮我把 paper/main.tex 摘要的第一句改得更紧凑一点。', before: () => text('notebook.md'), checks: [
      ['must', 'names /duck-polish in the reply', (t) => /duck-polish/.test(t.reply)],
      ['should', 'a one-sentence edit adds no notebook line', (t, before) => text('notebook.md') === before],
    ] },
    { name: 'why', resume: true, prompt: cmd('duck-why'), checks: [
      ['must', 'says it is a reconstruction, not a replay', (t) => /不是 ?AI ?内部过程的回放/.test(t.reply)],
      ['should', 'the breakdown is a blockquote', (t) => /^[ \t]*>[^\n]*用的思路/m.test(t.reply)],
      ['must', 'wrote a why report', () => reports('why').length > 0],
    ] },
    { name: 'quiet', resume: true, prompt: `${cmd('duck')} quiet`, checks: [
      ['must', 'config says quiet', () => switchIs('quiet')],
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
    { name: 'learn-ask', resume: true, prompt: cmd('duck-learn'), checks: [
      ['must', 'opens with the one question', (t) => /最想重来/.test(t.reply)],
    ] },
    { name: 'learn', resume: true, prompt: '补 seed 是我定的。最想重来的是摸方向，搜得太窄了。', checks: [
      ['must', 'wrote a learn report', () => reports('learn').length > 0],
      ['should', 'lists what was left to the AI', (t) => /交给 ?AI|AI 定/.test(t.reply)],
      ['should', 'next step uses the answer', (t) => /摸方向|检索|搜/.test(t.reply)],
    ] },
    { name: 'off', resume: true, prompt: `${cmd('duck')} off`, checks: [
      ['must', 'config says off', () => switchIs('off')],
    ] },
    { name: 'off-new-session', resume: false, prompt: `${cmd('duck-polish')} 润色 paper/main.tex 的结论一节`,
      before: () => ({ reports: allReports().length, notebook: text('notebook.md') }), checks: [
        ['must', 'hook injected the off note', (t) => /鸭子现在是 off/.test(t.injected)],
        ['must', 'no new report', (t, before) => allReports().length === before.reports],
        ['must', 'notebook untouched', (t, before) => text('notebook.md') === before.notebook],
      ] },
  ];
}

// The seven commands the main flow does not reach, in the order a student would meet them.
function moreStages() {
  const wrapped = (command, short, skill, prompt, extra = [], opts = {}) => ({ name: short, resume: true, prompt: `${cmd(command)} ${prompt}`, ...opts, checks: [
    ['must', `read library/${skill}`, (t) => readOf(t, skill)],
    ['must', `wrote a ${short} report`, () => reports(short).length > 0],
    ['should', 'reply has the why block', (t) => WHY_BLOCK.test(t.reply)],
    ['should', 'shows a card reminder with a plugin card number', (t) => /卡片提醒/.test(t.reply + newestReport(short))
      && cardIds(t.reply + newestReport(short)).some((id) => PLUGIN_CARDS.has(id))],
    ...extra,
  ] });
  const untouched = (rel) => ['should', `${rel} untouched`, () => projectFile(rel) === fixture(rel)];
  const notes = {};
  return [
    wrapped('duck-survey', 'survey', 'deep-research', '块稀疏注意力用于长文本推理加速。范围小一点：只看 2023 年以后，十篇以内，研究问题你来定两个。', [
      ['must', 'not turned on: hook injected the idle note', (t) => IDLE_ONLY(t)],
      ['should', 'cites checkable sources', (t) => /arxiv\.org|doi\.org|\b\d{4}\.\d{4,5}\b/i.test(t.reply + newestReport('survey'))],
    ], { search: true, timeout: 1800000 }),
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
  ];
}

// What a student's notebook holds from earlier weeks when the loop flow starts.
const LOOP_NOTEBOOK = [
  '- 10-09 写摘要｜用词强度跟着证据走，只跑了一次的结果不写 significantly（卡 W11）',
  '- 10-12 写引言｜挑战段写问题本身为什么难，不写方法实现起来难（卡 W09）',
];

// The loop flow's .duck/config.md: the format /duck on writes (skills/duck/SKILL.md, section 二).
const LOOP_CONFIG = '# Doctor Duck 设定\n\n开关：on\n\n## 按类静音\n学生说「这类我懂了」时，在这里记一行。\n\n## 静音的卡\n\n## 关掉的命令\n';

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
      ] },
    { name: 'exp-ok', resume: true, prompt: '先补到 3 个 seed，表等结果出来再改。', before: () => decisions().length, checks: [
      ['must', 'a new decision line says the student decided', (t, before) => decisions().slice(before).some((l) => /你定/.test(l))],
      ['should', 'reply shows the decision line', (t) => /▸ ?决策/.test(t.reply)],
    ] },
    { name: 'mute', resume: true, prompt: '多 seed 和方差这类我懂了，以后别讲了。', checks: [
      ['must', 'config mutes the category', () => /按类静音[\s\S]*(seed|种子|方差)/.test(text('config.md'))],
    ] },
    { name: 'mute-check', resume: true, prompt: '64k 长度上也出来了：BlockSkip 69.8，稠密 69.9，也只跑了一次。先记进 notes.md，表等补完 seed 再说。', checks: [
      ['should', 'notes.md got the 64k result', () => /64k/i.test(projectFile('notes.md'))],
      ['should', 'does not explain seeds again', (t) => !/为什么[:：]/.test(t.reply) && !/波动/.test(t.reply) && !/^[ \t]*>[^\n]*(seed|种子|方差)/im.test(t.reply)],
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
    ] },
    { name: 'why', resume: true, prompt: cmd('duck-why'), checks: [
      ['must', 'says it is a reconstruction, not a replay', (t) => /不是 ?AI ?内部过程的回放/.test(t.reply)],
      ['should', 'the breakdown is a blockquote', (t) => /^[ \t]*>[^\n]*用的思路/m.test(t.reply)],
      ['must', 'wrote a why report', () => reports('why').length > 0],
    ] },
    { name: 'learn-ask', resume: true, prompt: cmd('duck-learn'), checks: [
      ['must', 'opens with the one question', (t) => /最想重来/.test(t.reply)],
    ] },
    { name: 'learn', resume: true, prompt: '审稿是我让做的，怎么审都交给你了。最想重来的是实验部分，我想先弄清审稿人最可能抓哪一条。', checks: [
      ['must', 'wrote a learn report', () => reports('learn').length > 0],
      ['should', 'next step is about the experiments', (t) => /实验/.test(t.reply)],
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
    fs.writeFileSync(path.join(PROJECT, '.duck', 'config.md'), LOOP_CONFIG);
  }
  // The installed plugin must be this checkout, or the run tests something else. The last
  // deepseek-ducktor row wins: a package name (pnpm link in the profile) or a file path.
  const dump = host(['--profile', PROFILE, '--dump-config']).stdout || '';
  const row = [...dump.matchAll(/^- id: deepseek-ducktor\n\s+name: '?([^'\n]+)'?$/gm)].map((m) => m[1]).at(-1);
  const real = (f) => { try { return fs.realpathSync(f); } catch (err) { return ''; } };
  const target = !row ? '' : row === 'deepseek-ducktor'
    ? real(path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules', 'deepseek-ducktor'))
    : path.dirname(real(row.replace(/^file:\/\//, '')));
  if (target !== real(REPO)) {
    console.error(`profile ${PROFILE} under ${DSH_HOME} does not load this checkout (${row ? `row ${row} -> ${target || 'missing'}` : 'no deepseek-ducktor row'}); run: dsh plugin --profile ${PROFILE} add ${REPO}`);
    process.exit(2);
  }
}

function main() {
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
    if (t.completed && stage.name !== 'learn-ask' && checks.some((c) => !c.ok && c.severity === 'must') && /[？?]|你希望|请选择|请确认|选哪/.test(t.reply)) {
      followup = true;
      const t2 = turn(FOLLOWUP, session, opts, file('-followup'));
      const tokens = { ...t.tokens };
      for (const [k, v] of Object.entries(t2.tokens)) tokens[k] = (tokens[k] || 0) + v;
      t = { ...t2, reads: [...t.reads, ...t2.reads], tools: [...t.tools, ...t2.tools], injected: `${t.injected}\n${t2.injected}`,
        errors: [...t.errors, ...t2.errors], reply: `${t.reply}\n\n[学生] ${FOLLOWUP}\n\n${t2.reply}`, cost: t.cost + t2.cost, tokens,
        models: [...new Set([...t.models, ...t2.models])] };
      checks = evaluate(t);
    }
    // No key, an unknown model, a timeout or a dead network: the stage did not run, so its
    // checks say nothing (an empty reply passes every "does not say" check). Record one
    // failure and stop, since later stages continue this session.
    const dead = !t.completed;
    if (dead) checks = [{ severity: 'must', label: `the dsh run completed (exit ${t.exit}, turn ${t.turnReason || 'did not end'})`, ok: false }];
    transcripts.push(t);
    results.push({ stage: stage.name, prompt: stage.prompt, seconds: Math.round((Date.now() - started) / 1000),
      exit: t.exit, models: t.models, tokens: t.tokens, followup, tools: t.tools, errors: t.errors, checks, reply: t.reply });
    const mark = dead ? 'STOP' : checks.every((c) => c.ok) ? 'ok  ' : (checks.some((c) => !c.ok && c.severity === 'must') ? 'FAIL' : 'warn');
    console.log(`${mark} ${stage.name} (${results.at(-1).seconds}s)${followup ? ' after one follow-up answer' : ''}`);
    for (const c of checks.filter((x) => !x.ok)) console.log(`       ${c.severity}: ${c.label}`);
    if (dead) {
      stopped = stage.name;
      console.error(`stopped at ${stage.name}: ${t.errors[0] || 'no error event'}\n${t.stderr.trim().slice(0, 600)}\n`
        + `(session ${t.session || 'none'}; this run added ${t.injected.length} chars of Doctor Duck context)`);
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
  const summary = {
    host: HOST, dsh: (version.stdout || '').trim(), profile: PROFILE, flow: FLOW, model: MODEL || '(profile default)',
    models_seen: [...new Set(results.flatMap((r) => r.models || []))],
    commit: spawnSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    duck: process.env.DUCK_ROOT ? ROOT : lock.source.commit.slice(0, 7),
    when: new Date().toISOString(), tokens,
    must_failed: all.filter((c) => !c.ok && c.severity === 'must').length,
    should_failed: all.filter((c) => !c.ok && c.severity === 'should').length,
    passed: all.filter((c) => c.ok).length, total: all.length, stages: results, global,
  };
  if (fs.existsSync(path.join(PROJECT, '.duck'))) fs.cpSync(path.join(PROJECT, '.duck'), path.join(OUT, 'duck-files'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [`# e2e ${HOST} ${summary.dsh} ${FLOW} ${summary.commit}, Doctor Duck ${summary.duck} (${summary.model})`, '',
    `${summary.passed}/${summary.total} checks passed; must failed ${summary.must_failed}, should failed ${summary.should_failed}`, '',
    `Requests built for: ${summary.models_seen.join(', ') || 'none'}. Tokens reported in the --json stream (agent steps only): ${JSON.stringify(tokens)}`, ''];
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
