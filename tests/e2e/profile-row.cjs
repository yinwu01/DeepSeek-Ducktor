'use strict';
// Which checkout a dsh profile loads as deepseek-ducktor, read from `dsh --dump-config`.
// The dump prints a home-level row as a percent-encoded file:// URL and folds a long one
// into a `name: >-` block, so a plain one-line regex does not do.

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const unquote = (value) => {
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return JSON.parse(value);
  return value;
};
const indentOf = (line) => line.length - line.trimStart().length;

/** The name of every row with this id, in dump order (the last one is the one dsh uses). */
function rowNames(dump, id = 'deepseek-ducktor') {
  const lines = dump.split('\n');
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const row = /^(\s*)- id: (.+?)\s*$/.exec(lines[i]);
    if (!row || unquote(row[2]) !== id) continue;
    const depth = row[1].length;
    for (let j = i + 1; j < lines.length && indentOf(lines[j]) > depth && !/^\s*- /.test(lines[j]); j++) {
      const key = /^(\s*)name:\s*(.*?)\s*$/.exec(lines[j]);
      if (!key) continue;
      let value = key[2];
      if (/^[>|][-+]?$/.test(value)) {
        const block = [];
        for (let k = j + 1; k < lines.length && indentOf(lines[k]) > key[1].length; k++) block.push(lines[k].trim());
        value = block.join(value.startsWith('>') ? ' ' : '\n');
      } else {
        value = unquote(value);
      }
      names.push(value);
      break;
    }
  }
  return names;
}

const real = (file) => { try { return fs.realpathSync(file); } catch (err) { return ''; } };

/** The real directory a row name loads: a package linked into the profile, or a file. */
function rowCheckout(name, { dshHome, profile }) {
  if (!name) return '';
  if (name.startsWith('file:')) return path.dirname(real(fileURLToPath(name)));
  if (path.isAbsolute(name)) return path.dirname(real(name));
  return real(path.join(dshHome, 'profiles', profile, 'node_modules', name));
}

module.exports = { rowNames, rowCheckout };
