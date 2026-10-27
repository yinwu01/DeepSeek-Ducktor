'use strict';
// Which checkout a dsh profile loads as deepseek-doctor, read from `dsh --dump-config`.
// The dump prints a home-level row as a percent-encoded file:// URL and folds a long one
// into a `name: >-` block, keeps the user's key order (`- name:` may come before `id:`),
// and merges an enable toggle into the row as `disabled: true`, so a one-line regex does
// not do. The dump cannot show a row dsh's compatibility check denies; flow.cjs proves the
// plugin starts with a probe run as well.

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const unquote = (value) => {
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return JSON.parse(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
const indentOf = (line) => line.length - line.trimStart().length;
const KEY = /^(\s*)(- )?([A-Za-z_][\w-]*):(?:\s+(.*?))?\s*$/;

// The scalar keys of every list-item mapping in the dump, at any depth, in dump order.
function rows(dump) {
  const lines = dump.split('\n');
  // A key's value: inline, or a folded/literal block on the more-indented lines below it.
  const value = (raw, at, keyIndent) => {
    if (raw === undefined || raw === '') return null;
    if (!/^[>|][-+]?$/.test(raw)) return unquote(raw);
    const block = [];
    for (let k = at + 1; k < lines.length && (lines[k].trim() === '' || indentOf(lines[k]) > keyIndent); k++) block.push(lines[k].trim());
    while (block.length && block.at(-1) === '') block.pop();
    return block.join(raw.startsWith('>') ? ' ' : '\n');
  };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const first = KEY.exec(lines[i]);
    if (!first || !first[2]) continue;
    const keyIndent = first[1].length + 2;
    const row = { [first[3]]: value(first[4], i, keyIndent) };
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      const indent = indentOf(line);
      if (indent < keyIndent) break;
      const key = indent === keyIndent ? KEY.exec(line) : null;
      if (key && !key[2]) row[key[3]] = value(key[4], j, keyIndent);
    }
    out.push(row);
  }
  return out;
}

/** Every row with this id, in dump order (the last one is the one dsh uses). */
function idRows(dump, id = 'deepseek-doctor') {
  return rows(dump).filter((row) => row.id === id);
}

/** The name of every row with this id, in dump order. */
function rowNames(dump, id = 'deepseek-doctor') {
  return idRows(dump, id).map((row) => row.name).filter((name) => typeof name === 'string');
}

const real = (file) => { try { return fs.realpathSync(file); } catch (err) { return ''; } };

/** The real directory a row name loads: a package linked into the profile, or a file. */
function rowCheckout(name, { dshHome, profile }) {
  if (!name) return '';
  if (name.startsWith('file:')) return path.dirname(real(fileURLToPath(name)));
  if (path.isAbsolute(name)) return path.dirname(real(name));
  return real(path.join(dshHome, 'profiles', profile, 'node_modules', name));
}

module.exports = { idRows, rowNames, rowCheckout };
