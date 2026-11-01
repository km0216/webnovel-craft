#!/usr/bin/env node
'use strict';
// check_report.js —— 校验软审报告是否合规。reviewer 是 LLM，这层是它的确定性护栏。
// 查：字段齐不齐、枚举对不对、evidence 是不是正文里真实存在的片段、分数与裁决自相矛盾没有。
//
// 用法：
//   node check_report.js --book DIR --ch 12 --report reports/ch012.review.json [--json]
// 退出码：0 = 合规；1 = 不合规（报告作废，重跑 review）；2 = 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node check_report.js --book DIR --ch N --report FILE [--json]';
const VERDICTS = ['pass', 'revise', 'rewrite'];
const CATEGORIES = ['continuity', 'character', 'pacing', 'sao', 'hook', 'poison', 'pov', 'prose_ai', 'info_release'];
const SEVERITIES = ['blocking', 'major', 'minor'];
const DIMS = {
  sao_payoff: 2, opening_hook: 1, pacing_density: 2,
  no_poison_points: 1, emotion_immersion: 1, ending_hook: 1,
  prose_ai: 1.5, pov_discipline: 1.5, info_release: 1,
};

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.ch || !a.report) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const P = C.bookPaths(root);
  const ch = Number(a.ch);
  const errors = [];
  const warnings = [];

  let rep;
  try { rep = C.readJson(path.resolve(a.report)); } catch (e) { C.die(`读不到报告：${e.message}`, 2); }

  // ── 结构 ────────────────────────────────────────────────────
  if (rep.chapter !== ch) errors.push(`chapter=${rep.chapter} 与 --ch=${ch} 不一致`);
  if (!VERDICTS.includes(rep.verdict)) errors.push(`verdict=${rep.verdict} 非法（${VERDICTS.join('/')}）`);
  if (!rep.scores || typeof rep.scores !== 'object') errors.push('缺 scores');
  if (!Array.isArray(rep.issues)) errors.push('issues 必须是数组');

  for (const d of Object.keys(DIMS)) {
    const v = rep.scores && rep.scores[d];
    if (v === undefined) errors.push(`scores.${d} 缺失`);
    else if (![0, 1, 2].includes(v)) errors.push(`scores.${d}=${v} 必须是 0/1/2`);
  }
  for (const k of Object.keys(rep.scores || {})) {
    if (!(k in DIMS)) warnings.push(`scores.${k} 是 schema 外的维度，会被忽略`);
  }

  // ── 正文与证据 ──────────────────────────────────────────────
  const text = fs.existsSync(P.chapter(ch)) ? fs.readFileSync(P.chapter(ch), 'utf8') : '';
  if (!text) warnings.push('正文不存在，evidence 无法核对');

  for (const [i, it] of (rep.issues || []).entries()) {
    const at = `issues[${i}]`;
    if (!SEVERITIES.includes(it.severity)) errors.push(`${at}.severity=${it.severity} 非法`);
    if (!CATEGORIES.includes(it.category)) errors.push(`${at}.category=${it.category} 非法`);
    if (typeof it.evidence !== 'string' || it.evidence.trim().length < 2) errors.push(`${at}.evidence 必填且不能是空话`);
    else if (text && !text.includes(it.evidence)) {
      errors.push(`${at}.evidence 在正文里搜不到（编造或改写过）：「${String(it.evidence).slice(0, 20)}…」`);
    }
    if (!it.why) errors.push(`${at}.why 必填：违反了什么判据`);
    if (!it.fix_hint) errors.push(`${at}.fix_hint 必填：往哪个方向改`);
    if (typeof it.blocking !== 'boolean') errors.push(`${at}.blocking 必须是布尔`);
    if (it.blocking && it.severity !== 'blocking') errors.push(`${at} 标了 blocking:true 但 severity 不是 blocking`);
    if (it.category === 'poison' && it.severity === 'blocking') {
      const s = rep.scores && rep.scores.no_poison_points;
      if (s !== 0) errors.push(`${at} 判了毒点 blocking，但 no_poison_points=${s}，应给 0`);
    }
  }

  // ── 分数与裁决的一致性 ──────────────────────────────────────
  if (rep.scores && Object.keys(DIMS).every((d) => typeof rep.scores[d] === 'number')) {
    const total = Object.entries(DIMS).reduce((s, [d, w]) => s + rep.scores[d] * w, 0);
    const wsum = Object.values(DIMS).reduce((s, w) => s + w, 0);
    const avg = total / wsum;
    const expected = avg < 1.0 ? 'rewrite' : avg < 1.5 ? 'revise' : 'pass';
    if (rep.verdict !== expected) {
      errors.push(`加权 ${avg.toFixed(2)} 对应 verdict=${expected}，报告写的是 ${rep.verdict}`);
    }
    const hasBlocking = (rep.issues || []).some((i) => i.blocking);
    if (hasBlocking && rep.verdict === 'pass') errors.push('有 blocking issue 却给 pass');
    if (!hasBlocking && rep.verdict === 'rewrite' && avg >= 1.0) warnings.push('没有 blocking 却判 rewrite，确认理由');
    if (rep.scores.prose_ai === 0 && !(rep.issues || []).some((i) => i.category === 'prose_ai' || i.category === 'pacing')) {
      warnings.push('prose_ai=0 但没有对应 issue：跌 0 要给证据');
    }
  }

  // ── 输出 ────────────────────────────────────────────────────
  if (a.json) {
    process.stdout.write(`${JSON.stringify({ chapter: ch, ok: errors.length === 0, errors, warnings }, null, 2)}\n`);
  } else {
    console.log(`第 ${ch} 章报告校验：${errors.length ? '不合规' : '合规'}（${errors.length} 错 / ${warnings.length} 警）`);
    for (const e of errors) console.log(`  [错] ${e}`);
    for (const w of warnings) console.log(`  [警] ${w}`);
  }
  process.exit(errors.length ? 1 : 0);
}

main();
