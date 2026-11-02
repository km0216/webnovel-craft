#!/usr/bin/env node
'use strict';
// blind_report.js —— 盲测结果汇总：吃一份 [{reader, version, realism, distinct}]，出表 + 均值 + 判决。
// 用法：node blind_report.js --in results.json [--markdown]
// 退出码：0 成功 / 2 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node blind_report.js --in FILE [--markdown]';
const PASS = 3.5;

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.in) C.die(USAGE, 2);
  const raw = C.readJson(path.resolve(a.in));
  if (!Array.isArray(raw) || !raw.length) C.die('输入要是非空数组：[{reader, version, realism, distinct}]', 2);

  for (const [i, r] of raw.entries()) {
    for (const k of ['version', 'realism', 'distinct']) {
      if (r[k] === undefined) C.die(`第 ${i + 1} 条缺 ${k}`, 2);
    }
    if (![1, 2, 3, 4, 5].includes(r.realism) || ![1, 2, 3, 4, 5].includes(r.distinct)) {
      C.die(`第 ${i + 1} 条分数必须是 1–5`, 2);
    }
  }

  const byVer = new Map();
  for (const r of raw) {
    const e = byVer.get(r.version) || { realism: [], distinct: [], n: 0 };
    e.realism.push(r.realism);
    e.distinct.push(r.distinct);
    e.n += 1;
    byVer.set(r.version, e);
  }
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const stats = [...byVer.entries()]
    .map(([version, e]) => ({ version, n: e.n, realism: mean(e.realism), distinct: mean(e.distinct) }))
    .sort((x, y) => y.realism - x.realism || y.distinct - x.distinct);

  const top = stats[0];
  const second = stats[1];
  const gap = second ? top.realism - second.realism : 0;
  const verdict = top.realism >= PASS ? (gap >= 0.5 ? 'A 版可用，差距成立' : '两版分不开（差异没进到字面）') : '都没到 3.5，重写对白，别靠形容词补救';

  if (a.markdown) {
    const L = [];
    L.push('| 版本 | 份数 | realism | distinct |');
    L.push('|---|---|---|---|');
    for (const s of stats) L.push(`| ${s.version} | ${s.n} | ${s.realism.toFixed(2)} | ${s.distinct.toFixed(2)} |`);
    L.push('');
    L.push(`判决：${verdict}${second ? `（差 ${gap.toFixed(2)}）` : ''}`);
    console.log(L.join('\n'));
    return;
  }

  const rows = raw.map((r) => `${String(r.reader || '?').padEnd(4)} ${String(r.version).padEnd(10)} realism ${r.realism}  distinct ${r.distinct}`);
  console.log(rows.join('\n'));
  console.log('');
  for (const s of stats) console.log(`${s.version.padEnd(12)} n=${s.n}  realism ${s.realism.toFixed(2)}  distinct ${s.distinct.toFixed(2)}`);
  console.log(`\n判决：${verdict}${second ? `（领先 ${gap.toFixed(2)}）` : ''}`);
  console.log('提醒：分数是相对分，只能比同一轮的 A/B，不要跨轮比。');
}

main();
