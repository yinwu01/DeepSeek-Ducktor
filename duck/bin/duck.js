#!/usr/bin/env node
// Ducktor hook script. Code in bin/ is MIT; see LICENSES/README.md.
// Two jobs:
//   session-start  tell the AI where the plugin lives and pass along the project's
//                  .duck/config.md; load the resident rules only when the project has
//                  turned the duck on (开关：on or quiet), otherwise a short idle note
//   allow          PreToolUse in Claude Code: let it read the plugin's own files (library/,
//                  cards/, handbook/ ...) and add to the records Ducktor keeps in the project's
//                  .duck/ (notebook, decisions, reports) without a permission prompt; anything
//                  else gets no answer, so the host asks as usual
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
// A switch line looks like "开关：quiet", or "Switch: quiet" in a config written in English.
// Leading list marks, quotes, headings and bold are allowed.
const SWITCH_LINE = /^[\s>#*-]*\**(?:开关|switch)\**\s*[:：=]\s*(.*)$/gim;

// Line ends are made \n and a BOM is dropped, so a file saved on Windows reads the same.
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
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
// on or quiet loads the resident rules; off is the same as not turned on. note is a sentence
// for the AI when the switch line was there but could not be read.
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

// The student's edited copy of the rules wins over the plugin's own. A copy made before
// 「每次都照做」 existed gets that section from the plugin, so turning the duck on never
// gives fewer of those rules than leaving it off.
function coreRules(project) {
  const copy = path.join(project, '.duck', 'skills', 'core.md');
  const own = readText(copy);
  if (own !== null) {
    const parts = [own];
    if (!EVERY_TIME.test(own)) {
      const section = sectionOf(readText(path.join(ROOT, 'rules', 'core.md')) || '', EVERY_TIME);
      if (section) parts.push(`${section}\n\n（上面「每次都照做」一节来自插件原版 rules/core.md：学生的副本里没有这一节。）`);
    }
    parts.push('（这份常驻规则是项目里的副本 .duck/skills/core.md，学生改过。原版在插件根目录的 rules/core.md。）');
    return parts.join('\n\n');
  }
  return readText(path.join(ROOT, 'rules', 'core.md')) || '（没读到 rules/core.md，常驻规则这次缺席。）';
}

// The 「每次都照做」 section of rules/core.md: the few rules that hold in every mode (the
// student's language, checking facts, pushback). A student's copy of the rules made before
// it existed gets it from the plugin. Commands carry it, with 「东西在哪」, in their own
// files (scripts/build.js copies both in), so a project that has not turned Ducktor on
// pays only for the short idle note.
const EVERY_TIME = /^##[ \t]*每次都照做[ \t]*$/m;

// 「回复：短」 (English config: Reply: short) holds for every reply of every session. On the
// second day of an 11-04 trial the first reply of a new session came back long although the line
// was in the config passed through below, so the hook says it again in words.
const SHORT_REPLIES = /^[ \t>*-]*(?:回复[ \t]*[:：][ \t]*短|reply[ \t]*:[ \t]*short)[ \t。.]*$/im;

// One "## " section of a rules file, heading included; '' when it is not there.
function sectionOf(text, heading) {
  const m = heading.exec(text);
  if (m === null) return '';
  const end = text.indexOf('\n## ', m.index + 1);
  return text.slice(m.index, end < 0 ? undefined : end).trim();
}

function buildContext(project) {
  const config = readText(path.join(project, '.duck', 'config.md'));
  const { mode, note } = modeOf(config);
  const parts = [`Ducktor 插件根目录：${ROOT}`];

  if (mode === 'unset' || mode === 'off') {
    // off is the same as not turned on: the idle note, and commands keep their why and records.
    parts.push(readText(path.join(ROOT, 'rules', 'idle.md')) || 'Ducktor 没在这个项目开启。');
  } else {
    parts.push(coreRules(project));
  }

  if (config !== null) {
    const shown = config.length > CONFIG_LIMIT
      ? `${config.slice(0, CONFIG_LIMIT)}\n……（后面太长没放进来，要用时直接读这个文件）`
      : config;
    const label = { unset: '没开启', off: 'off，和没开启一样' }[mode] || mode;
    parts.push(`项目的 .duck/config.md（开关：${label}）：\n${shown}`);
    if (note) parts.push(note);
    if (SHORT_REPLIES.test(config)) parts.push('学生要过回复写短（config.md 里的「回复：短」）：这次会话的每条回复都写短；长的内容写进文件，回复里说在哪。');
    if (config.includes('�')) parts.push('.duck/config.md 里有读不出的字节（可能不是 UTF-8 编码），开关可能没认对。');
  }
  return parts.join('\n\n');
}

function sessionStart() {
  const input = readInput();
  // Claude Code sets CLAUDE_PROJECT_DIR; Claude Code and Codex send cwd; Cursor sends workspace_roots.
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  // Claude Code's project root first: after `cd paper` the hook input's cwd moves, and a
  // hook rerun on compact, clear or resume would read paper/.duck/ instead.
  const project = [process.env.CLAUDE_PROJECT_DIR, input.cwd, roots[0]]
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

function allowRead(input) {
  const toolInput = input.tool_input || {};
  if (!['Read', 'Glob', 'Grep'].includes(input.tool_name)) return;
  // Glob and Grep search the folder in path; a file_path next to it is not what they read.
  let target = input.tool_name === 'Read' ? toolInput.file_path || toolInput.path : toolInput.path;
  // Glob and Grep can also reach files through a pattern (Glob's pattern, Grep's glob
  // filter). Allow only patterns that stay inside the root: no '..' anywhere (braces such as
  // {..,x} would hide it from a check of whole path parts), no '~', and an absolute pattern
  // must start inside the root.
  const pattern = input.tool_name === 'Glob' ? toolInput.pattern : input.tool_name === 'Grep' ? toolInput.glob : undefined;
  if (typeof pattern === 'string' && pattern) {
    // '~' anywhere, and a brace alternative that starts a new absolute path ({/etc/*,x}), also leave the root.
    if (pattern.includes('~') || pattern.includes('..') || /[{,]\s*(?:[\\/]|[A-Za-z]:)/.test(pattern)) return;
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
      permissionDecisionReason: 'Ducktor reads its own plugin files',
    },
  }));
}

// PreToolUse for Write, Edit and MultiEdit. Says allow only for the records Ducktor keeps in
// the project's .duck/: notebook.md, decisions.md and reports/*.md. A denied prompt there
// loses the record. notebook.md and decisions.md are logs the student may show at a group
// meeting, so only adding goes through without a prompt: creating the file, a Write that keeps
// the old text at its start, an Edit whose new text starts with the old text. Rewriting or
// deleting a line asks as usual. Files the next session loads as settings or rules
// (config.md, skills/, cards/) also ask, so changing them stays the student's call.
// A symlinked or hard-linked .duck/, reports/ or record file is not followed.
const RECORDS = /^(?:(?:notebook|decisions)\.md|reports\/[^/]+\.md)$/;
const LOGS = /^(?:notebook|decisions)\.md$/;

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    return null;
  }
}

// Real path of something that may not exist yet: resolve the deepest part that exists and
// put the rest back on.
function realPathOf(p) {
  const rest = [];
  let dir = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync(dir), ...rest);
    } catch (err) {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

// True when the write leaves the old file as it was and only adds after its end. Edits are
// applied here the way the host applies them (each old_string must occur exactly once;
// replace_all is refused), and the result is compared byte for byte with the old file.
function onlyAdds(input, target, stat) {
  const toolInput = input.tool_input || {};
  if (!stat || stat.size === 0) return true;
  const old = fs.readFileSync(target);
  let result;
  if (input.tool_name === 'Write') {
    result = toolInput.content;
  } else {
    const edits = input.tool_name === 'MultiEdit' ? toolInput.edits : [toolInput];
    if (!Array.isArray(edits) || edits.length === 0) return false;
    result = old.toString('utf8');
    for (const e of edits) {
      if (!e || e.replace_all || typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || e.old_string === '') return false;
      const at = result.indexOf(e.old_string);
      if (at < 0 || result.indexOf(e.old_string, at + 1) >= 0) return false;
      result = result.slice(0, at) + e.new_string + result.slice(at + e.old_string.length);
    }
  }
  if (typeof result !== 'string') return false;
  const bytes = Buffer.from(result, 'utf8');
  if (bytes.length < old.length || !bytes.subarray(0, old.length).equals(old)) return false;
  // When the old file does not end in a newline, text added straight after it lands on the
  // old last line and changes what that line says. Only a new line counts as adding.
  if (bytes.length === old.length || old[old.length - 1] === 0x0a) return true;
  const next = bytes[old.length];
  return next === 0x0a || (next === 0x0d && bytes[old.length + 1] === 0x0a);
}

function allowRecord(input) {
  const file = (input.tool_input || {}).file_path;
  // Claude Code's project root, not the shell's current folder: after `cd paper` the hook's
  // cwd moves, but .duck/ stays where the session started.
  const project = [process.env.CLAUDE_PROJECT_DIR, input.cwd].find((p) => typeof p === 'string' && p);
  if (typeof file !== 'string' || !file || !project) return;
  const root = realPathOf(path.resolve(project));
  const resolved = path.resolve(typeof input.cwd === 'string' && input.cwd ? input.cwd : project, file);
  const parent = realPathOf(path.dirname(resolved));
  if (!root || !parent) return;
  const duck = path.join(root, '.duck');
  const rel = path.relative(duck, path.join(parent, path.basename(resolved))).split(path.sep).join('/');
  if (!RECORDS.test(rel)) return;
  const duckStat = lstatOrNull(duck);
  if (!duckStat || !duckStat.isDirectory()) return;
  if (rel.startsWith('reports/')) {
    const reports = lstatOrNull(path.join(duck, 'reports'));
    if (reports && !reports.isDirectory()) return;
  }
  const target = path.join(duck, rel);
  const stat = lstatOrNull(target);
  if (stat && !(stat.isFile() && stat.nlink === 1)) return;
  if (LOGS.test(rel) && !onlyAdds(input, target, stat)) return;
  fs.writeSync(1, JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Ducktor writes its own record in .duck/',
    },
  }));
}

function main(command) {
  // allow-read is the name the hooks file used before writes were added.
  if (command === 'allow' || command === 'allow-read') {
    try {
      const input = readInput();
      if (['Write', 'Edit', 'MultiEdit'].includes(input.tool_name)) allowRecord(input);
      else allowRead(input);
    } catch (err) { /* stay silent: the host asks as usual */ }
    return;
  }
  let context = '';
  try {
    if (command === 'session-start') context = sessionStart();
  } catch (err) {
    context = `Ducktor 插件根目录：${ROOT}\n\n（开场脚本出错，常驻规则这次没加载：${err.message}）`;
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
