// Reading a dsh session log: $DSH_HOME/sessions/<project key>/<session id>/session.v4.jsonl.zstd
// (or .jsonl when compression is off). The zstd file is a run of independent frames, one per
// appended batch; Node's one-shot decoder stops after the first, so frames are split here the
// way dsh's own JSONL backend does (frame header and block headers, no decoding) and each is
// decoded on its own. A torn last frame (a run still writing) is skipped.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ZSTD_MAGIC = 0xfd2fb528;

function zstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const start = offset;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`not a zstd frame at byte ${offset}`);
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    let complete = false;
    while (offset + 3 <= buffer.length) {
      const header = buffer.readUIntLE(offset, 3);
      offset += 3;
      offset += ((header >>> 1) & 3) === 1 ? 1 : header >>> 3;
      if ((header & 1) !== 0) { complete = true; break; }
    }
    if (checksum) offset += 4;
    if (!complete || offset > buffer.length) break;
    frames.push(buffer.subarray(start, offset));
  }
  return frames;
}

/** Every event in one session log, in order. */
function readSessionEvents(file) {
  const raw = fs.readFileSync(file);
  const text = file.endsWith('.zstd')
    ? zstdFrames(raw).map((frame) => zlib.zstdDecompressSync(frame).toString('utf8')).join('')
    : raw.toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch (err) { /* a torn last line */ }
  }
  return events;
}

/** The log file of one session under DSH_HOME, or '' when there is none yet. */
function sessionLogPath(dshHome, sessionId) {
  const root = path.join(dshHome, 'sessions');
  let projects = [];
  try { projects = fs.readdirSync(root); } catch (err) { return ''; }
  for (const project of projects) {
    for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
      const file = path.join(root, project, sessionId, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return '';
}

module.exports = { readSessionEvents, sessionLogPath, zstdFrames };
