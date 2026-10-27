#!/usr/bin/env node
// Audit dsh session logs after an e2e run. Per dsh home: top-level and subagent sessions, which
// of them got Ducktor context, and for each successful compaction whether the context is
// still in what the model sees (rebuilt with dsh's own foldSurface) and, if not, whether it was
// given again before the next model reply.
//   DSH=<path to the dsh command> node tests/e2e/sessions-audit.cjs <home holding .dsh>...
// Without DSH the compaction lines only give seqs.
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { readSessionEvents } = require('./session-log.cjs');

const isContext = (e) => e && e.type === 'user/message' && e.data && e.data.source && e.data.source.kind === 'ducktor';

async function foldSurfaceOf(dsh) {
  if (!dsh) return undefined;
  const entry = fs.realpathSync(dsh);
  const { foldSurface } = await import(createRequire(entry).resolve('@deepseek-ai/dsh-session'));
  return foldSurface;
}

function sessionFiles(home) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'session.v4.jsonl.zstd') files.push(file);
    }
  };
  const root = path.join(home, '.dsh', 'sessions');
  if (fs.existsSync(root)) walk(root);
  return files;
}

async function main() {
  const foldSurface = await foldSurfaceOf(process.env.DSH);
  for (const home of process.argv.slice(2)) {
    const totals = { top: 0, topWithContext: 0, sub: 0, subWithContext: 0, compactions: 0 };
    for (const file of sessionFiles(home)) {
      const records = readSessionEvents(file);
      const header = records.find((e) => e.type === 'session') || {};
      const sub = header.origin === 'subagent' || (header.delegationDepth || 0) > 0;
      const contexts = records.filter(isContext);
      totals[sub ? 'sub' : 'top'] += 1;
      if (contexts.length) totals[sub ? 'subWithContext' : 'topWithContext'] += 1;
      const events = records.filter((e) => typeof e.seq === 'number').sort((a, b) => a.seq - b.seq);
      const done = events.filter((e) => e.type === 'compaction/end' && !(e.data && e.data.error));
      totals.compactions += done.length;
      for (const end of done) {
        let line = `   ${path.basename(path.dirname(file))} compaction ending at seq ${end.seq}`;
        if (foldSurface && events.every((e, i) => e.seq === i)) {
          const visible = foldSurface(events.slice(0, end.seq + 1)).nodes.some((seq) => isContext(events[seq]));
          const nextReply = events.find((e) => e.seq > end.seq && e.type === 'assistant/message');
          const given = events.find((e) => e.seq > end.seq && isContext(e) && (!nextReply || e.seq < nextReply.seq));
          line += visible ? ': context still visible' : `: context dropped, ${given ? `given again at seq ${given.seq}` : 'NOT given again before the next reply'}`;
        }
        console.log(line);
      }
    }
    console.log(path.basename(home), JSON.stringify(totals));
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
