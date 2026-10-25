#!/usr/bin/env node
// Doctor Duck hook script. Code in bin/ is MIT; see LICENSES/README.md.
// Two jobs:
//   session-start  tell the AI where the plugin lives and pass along the project's
//                  .duck/config.md; load the resident rules only when the project has
//                  turned the duck on (开关：on or quiet), otherwise a short idle note
//   allow-read     let Claude Code read the plugin's own files (library/, cards/,
//                  handbook/ ...) without a permission prompt; nothing outside the root
// Rule text stays in rules/ (or the student's copy in .duck/skills/), never in this file.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_LIMIT = 1200; // characters of .duck/config.md passed through as-is

// Values the switch line may carry. The Chinese words are what students tend to type.
const MODES = {
  on: 'on', quiet: 'quiet', off: 'off',
  开: 'on', 打开: 'on', 开启: 'on', 启用: 'on', 静音: 'quiet', 安静: 'quiet', 关: 'off', 关闭: 'off', 关掉: 'off',
};
// A switch line looks like "开关：quiet". Leading list marks, quotes, headings and bold are allowed.
const SWITCH_LINE = /^[\s>#*-]*\**开关\**\s*[:：=]\s*(.*)$/gm;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return null;
  }
}

// Both hosts send the hook input as JSON on stdin; its cwd is the project directory.
function readInput() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

// Returns { mode, note }. mode is on, quiet, off, or unset: the duck has not been turned
// on in this project (no file, no switch line, or a value we cannot read). Only an explicit
// on or quiet loads the resident rules. note is a sentence for the AI when the switch line
// was there but could not be read.
function modeOf(config) {
  if (!config) return { mode: 'unset', note: null };
  const seen = [];
  for (const m of config.matchAll(SWITCH_LINE)) {
    const value = m[1].replace(/\*/g, '').trim();
    const word = value.split(/[\s（(，,。.;；]/)[0].toLowerCase();
    if (MODES[word]) return { mode: MODES[word], note: null };
    seen.push(value);
  }
  if (seen.length === 0) return { mode: 'unset', note: null };
  return {
    mode: 'unset',
    note: `.duck/config.md 的开关行写的是「${seen[0]}」，只认 on、quiet、off，这次按没开启处理。请提醒学生改成这三个词之一。`,
  };
}

// The student's edited copy of the rules wins over the plugin's own.
function coreRules(project) {
  const copy = path.join(project, '.duck', 'skills', 'core.md');
  const own = readText(copy);
  if (own !== null) return `${own}\n\n（这份常驻规则是项目里的副本 .duck/skills/core.md，学生改过。原版在插件根目录的 rules/core.md。）`;
  return readText(path.join(ROOT, 'rules', 'core.md')) || '（没读到 rules/core.md，常驻规则这次缺席。）';
}

// The 「东西在哪」 section of the plugin's rules/core.md: where files live, how to read them,
// the skill-name table. Commands need it even when the resident rules are not loaded.
function basics() {
  const core = readText(path.join(ROOT, 'rules', 'core.md')) || '';
  const start = core.indexOf('## 东西在哪\n');
  if (start < 0) return '';
  const end = core.indexOf('\n## ', start + 1);
  return core.slice(start, end < 0 ? undefined : end).trim();
}

function buildContext(project) {
  const config = readText(path.join(project, '.duck', 'config.md'));
  const { mode, note } = modeOf(config);
  const parts = [`Doctor Duck 插件根目录：${ROOT}`];

  if (mode === 'unset' || mode === 'off') {
    const note = mode === 'unset'
      ? readText(path.join(ROOT, 'rules', 'idle.md')) || 'Doctor Duck 没在这个项目开启。'
      : readText(path.join(ROOT, 'rules', 'off.md')) || '开关：off。';
    parts.push(note);
    const b = basics();
    if (b) parts.push(b);
  } else {
    parts.push(coreRules(project));
  }

  if (config !== null) {
    const shown = config.length > CONFIG_LIMIT
      ? `${config.slice(0, CONFIG_LIMIT)}\n……（后面太长没放进来，要用时直接读这个文件）`
      : config;
    parts.push(`项目的 .duck/config.md（开关：${mode === 'unset' ? '没开启' : mode}）：\n${shown}`);
    if (note) parts.push(note);
    if (config.includes('�')) parts.push('.duck/config.md 里有读不出的字节（可能不是 UTF-8 编码），开关可能没认对。');
  }
  return parts.join('\n\n');
}

function sessionStart() {
  const input = readInput();
  // Claude Code and Codex send cwd; Cursor sends workspace_roots.
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  const project = [input.cwd, roots[0], process.env.CLAUDE_PROJECT_DIR]
    .find((p) => typeof p === 'string' && p);
  return buildContext(project || process.cwd());
}

// True when target (a file or folder) sits inside the plugin root, symlinks resolved.
function insideRoot(target) {
  if (typeof target !== 'string' || !target) return false;
  let real;
  try {
    real = fs.realpathSync(path.resolve(target));
  } catch (err) {
    return false;
  }
  const rel = path.relative(fs.realpathSync(ROOT), real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// PreToolUse for Read, Glob and Grep. Says allow only for paths under the plugin root;
// for anything else it prints nothing, so the host's usual permission rules apply.
// The fixed leading part of a glob pattern: '/a/b/**/*.md' gives '/a/b'.
function globBase(pattern) {
  const fixed = [];
  for (const part of pattern.split(/[\\/]/)) {
    if (/[*?[\]{}]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join(path.sep) || path.sep;
}

function allowRead() {
  const input = readInput();
  const toolInput = input.tool_input || {};
  let target = toolInput.file_path || toolInput.path;
  // Glob and Grep can also reach files through a pattern (Glob's pattern, Grep's glob
  // filter). Allow only patterns that stay inside the root: no '..', no '~', and an
  // absolute pattern must start inside the root.
  const pattern = input.tool_name === 'Glob' ? toolInput.pattern : input.tool_name === 'Grep' ? toolInput.glob : undefined;
  if (typeof pattern === 'string' && pattern) {
    if (pattern.startsWith('~') || pattern.split(/[\\/]/).includes('..')) return;
    if (path.isAbsolute(pattern)) {
      if (!insideRoot(globBase(pattern))) return;
      if (!target) target = globBase(pattern);
    }
  }
  if (!insideRoot(target)) return;
  fs.writeSync(1, JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Doctor Duck reads its own plugin files',
    },
  }));
}

function main(command) {
  if (command === 'allow-read') {
    try { allowRead(); } catch (err) { /* stay silent: the host asks as usual */ }
    return;
  }
  let context = '';
  try {
    if (command === 'session-start') context = sessionStart();
  } catch (err) {
    context = `Doctor Duck 插件根目录：${ROOT}\n\n（开场脚本出错，常驻规则这次没加载：${err.message}）`;
  }
  if (!context) return;
  // Claude Code and Codex read hookSpecificOutput; Cursor reads additional_context.
  // Print only the one the host reads: Claude Code would inject both, twice.
  // writeSync, because an async pipe write can be lost when the process exits right after it.
  const output = process.env.CURSOR_PLUGIN_ROOT
    ? { additional_context: context }
    : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
  fs.writeSync(1, JSON.stringify(output));
}

module.exports = { main, modeOf, buildContext, insideRoot, ROOT };

if (require.main === module) main(process.argv[2]);
