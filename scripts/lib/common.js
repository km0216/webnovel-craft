'use strict';
// webnovel-craft · 公共层：文件读写、原子写、参数解析、日记。
// 零第三方依赖。所有写操作都是「先写临时文件再 rename」。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function readJsonSafe(p, fallback) {
  try { return readJson(p); } catch (e) { return fallback; }
}

function writeTextAtomic(p, text) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, p); // libuv 用 MOVEFILE_REPLACE_EXISTING，Windows 下可覆盖
}

function writeJson(p, obj) { writeTextAtomic(p, `${JSON.stringify(obj, null, 2)}\n`); }

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); } catch (e) { throw new Error(`${p} 第 ${i + 1} 行不是合法 JSON`); }
    });
}

function writeJsonl(p, rows) {
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  writeTextAtomic(p, rows.length ? `${body}\n` : '');
}

function appendJsonl(p, row) {
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, `${JSON.stringify(row)}\n`, 'utf8');
}

// --book DIR / --book=DIR / --ch 3 / --flag
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else { out[key] = true; }
    } else { out._.push(a); }
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function fmtBytes(n) { return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; }

// 书根下所有约定路径（单一出处，别在脚本里各写一份）
function bookPaths(root) {
  const p = (...xs) => path.join(root, ...xs);
  return {
    root,
    book: p('book.json'),
    facts: p('canon', 'facts.jsonl'),
    charactersDir: p('canon', 'characters'),
    char: (id) => p('canon', 'characters', `${id}.json`),
    foreshadow: p('ledger', 'foreshadow.jsonl'),
    chapterLog: p('ledger', 'chapter-log.jsonl'),
    contract: (n) => p('plan', 'ch', `ch${String(n).padStart(3, '0')}.contract.json`),
    contractDir: p('plan', 'ch'),
    chapter: (n) => p('chapters', `ch${String(n).padStart(3, '0')}.md`),
    chapterDir: p('chapters'),
    report: (n) => p('reports', `ch${String(n).padStart(3, '0')}.review.json`),
    reportDir: p('reports'),
    state: p('state'),
    context: p('state', 'context.md'),
    knowledge: p('state', 'knowledge.json'),
    craft: p('.craft'),
    settleLog: p('.craft', 'settle.log.jsonl'),
    ctx: (n) => p('.craft', `ctx-ch${String(n).padStart(3, '0')}.md`),
    trace: (n) => p('.craft', `trace-ch${String(n).padStart(3, '0')}.json`),
  };
}

const FORESHADOW_STATES = ['setup', 'hinted', 'pending_payoff', 'paid_off', 'failed'];
const CANON_STATUS = ['canon', 'pending', 'rejected', 'idea', 'inferred'];

module.exports = {
  ensureDir, readJson, readJsonSafe, writeTextAtomic, writeJson,
  readJsonl, writeJsonl, appendJsonl, parseArgs, die, sha1, fmtBytes,
  bookPaths, FORESHADOW_STATES, CANON_STATUS,
};
