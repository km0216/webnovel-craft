#!/usr/bin/env node
'use strict';
// settle.js —— 章节结算：把本章发生的**变化**写成增量，合并进账本。
// 铁律：只失效不删（旧的盖 valid_until_ch，不删记录）；章级幂等（同一 delta 提交两次只算一次）；先校验后落盘。
//
// 用法：
//   node settle.js --book DIR --ch 12 --delta delta.json [--dry-run] [--strict-evidence]
// 退出码：0 = 已结算或幂等跳过；1 = 校验失败（未写入任何文件）；2 = 用法错误

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = `Usage: node settle.js --book DIR --ch N --delta FILE [--dry-run] [--strict-evidence]`;

const FORESHADOW_OPS = {
  plant: { from: [], to: 'setup', needs: ['content', 'payoff_window', 'payoff_signal'] },
  hint: { from: ['setup'], to: 'hinted', needs: [] },
  ready: { from: ['hinted'], to: 'pending_payoff', needs: [] },
  payoff: { from: ['pending_payoff'], to: 'paid_off', needs: ['evidence'] },
  fail: { from: ['setup', 'hinted', 'pending_payoff'], to: 'failed', needs: ['reason'] },
};

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.ch || !a.delta) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const ch = Number(a.ch);
  if (!Number.isInteger(ch) || ch < 1) C.die(`--ch 必须是 ≥1 的整数，收到 ${a.ch}`, 2);

  const P = C.bookPaths(root);
  if (!fs.existsSync(P.book)) C.die(`找不到 ${P.book}`, 2);

  const book = C.readJson(P.book);
  const delta = C.readJson(path.resolve(a.delta));
  const errors = [];
  const warnings = [];

  // ── 0. 基本形状 ──────────────────────────────────────────────
  if (delta.chapter !== ch) errors.push(`delta.chapter=${delta.chapter} 与 --ch=${ch} 不一致`);
  if (typeof delta.summary !== 'string' || !delta.summary.trim()) {
    errors.push('delta.summary 必填：本章三句话（谁的状态变了 / 哪个伏笔动了 / 哪条冲突推进了）');
  } else if (delta.summary.length > 200) {
    errors.push(`delta.summary 超长（${delta.summary.length} 字，上限 200）`);
  }
  for (const k of ['facts', 'facts_retire', 'foreshadow', 'characters', 'reader_known']) {
    if (delta[k] !== undefined && !Array.isArray(delta[k])) errors.push(`delta.${k} 必须是数组`);
  }

  const facts = C.readJsonl(P.facts);
  const fore = C.readJsonl(P.foreshadow);
  const log = C.readJsonl(P.chapterLog);
  const settleLog = C.readJsonl(P.settleLog);

  // ── 1. 幂等 ──────────────────────────────────────────────────
  const key = C.sha1(JSON.stringify(delta));
  const prior = settleLog.find((r) => r.chapter === ch && r.key === key);
  if (prior) {
    console.log(`第 ${ch} 章这份 delta 已结算过（${prior.at}，key=${key}），跳过。`);
    return;
  }
  if (settleLog.some((r) => r.chapter === ch)) {
    warnings.push(`第 ${ch} 章已有别的 delta 结算记录；本次是追加提交（不是覆盖），确认不是重复写两遍。`);
  }

  const factsById = new Map(facts.map((f) => [f.id, f]));
  const foreById = new Map(fore.map((f) => [f.id, f]));
  const newFacts = [];
  const retired = [];

  // ── 2. facts ─────────────────────────────────────────────────
  const seenNew = new Set();
  for (const [i, f] of (delta.facts || []).entries()) {
    const at = `facts[${i}]`;
    for (const k of ['id', 'subj', 'pred', 'obj']) {
      if (!f[k] || typeof f[k] !== 'string') { errors.push(`${at}.${k} 必填且为字符串`); }
    }
    if (factsById.has(f.id) || seenNew.has(f.id)) errors.push(`${at}.id=${f.id} 已存在（同一 id 不能提交两次）`);
    seenNew.add(f.id);
    if (f.canon_status && !C.CANON_STATUS.includes(f.canon_status)) {
      errors.push(`${at}.canon_status=${f.canon_status} 非法，允许：${C.CANON_STATUS.join(' / ')}`);
    }
    const status = f.canon_status || 'canon';
    const cardinality = f.cardinality || 'single';
    const vfv = f.visible_from_volume === undefined ? 1 : f.visible_from_volume;
    if (!Number.isInteger(vfv) || vfv < 1) errors.push(`${at}.visible_from_volume 必须是 ≥1 的整数`);
    if (typeof f.evidence !== 'string' || !f.evidence.trim()) {
      warnings.push(`${at} 没有 evidence：审校引用时无法回溯，建议补一句原文。`);
    }

    // 冲突：同一 subject+predicate 的 single 事实，旧的有效、新值不同，必须显式 supersede
    if (status === 'canon' && cardinality === 'single') {
      const clash = facts.find((o) => o.subj === f.subj && o.pred === f.pred
        && (o.valid_until_ch === null || o.valid_until_ch === undefined)
        && o.obj !== f.obj && o.canon_status === 'canon');
      if (clash) {
        const sup = (f.supersedes || []).includes(clash.id);
        if (!sup) {
          errors.push(`${at} 「${f.subj}·${f.pred}」与 ${clash.id}（=${clash.obj}，第 ${clash.valid_from_ch} 章起）冲突。`
            + ` 若这是本章的变化：在 ${at}.supersedes 里写 ["${clash.id}"]，旧的会被盖上终点（不删）。`);
        } else {
          retired.push({ id: clash.id, until_ch: Math.max(0, ch - 1), reason: `被 ${f.id} 取代（第 ${ch} 章）` });
        }
      }
    }

    newFacts.push({
      id: f.id,
      subj: f.subj,
      pred: f.pred,
      obj: f.obj,
      cardinality,
      canon_status: status,
      valid_from_ch: Number.isInteger(f.valid_from_ch) ? f.valid_from_ch : ch,
      valid_until_ch: null,
      visible_from_volume: vfv,
      source_ch: Number.isInteger(f.source_ch) ? f.source_ch : ch,
      evidence: f.evidence || '',
    });
  }

  // ── 3. facts_retire（显式退场，不靠 supersede）────────────────
  for (const [i, r] of (delta.facts_retire || []).entries()) {
    const at = `facts_retire[${i}]`;
    const cur = factsById.get(r.id);
    if (!cur) { errors.push(`${at}.id=${r.id} 不存在`); continue; }
    if (cur.valid_until_ch !== null && cur.valid_until_ch !== undefined) {
      warnings.push(`${at}.id=${r.id} 早已在第 ${cur.valid_until_ch} 章失效，忽略。`);
      continue;
    }
    if (!r.reason) errors.push(`${at}.reason 必填：为什么它不再为真`);
    retired.push({ id: r.id, until_ch: Number.isInteger(r.until_ch) ? r.until_ch : Math.max(0, ch - 1), reason: r.reason || '' });
  }

  // ── 4. foreshadow（状态机，只能前进）──────────────────────────
  const foreUpdates = new Map();
  for (const [i, op] of (delta.foreshadow || []).entries()) {
    const at = `foreshadow[${i}]`;
    const spec = FORESHADOW_OPS[op.op];
    if (!spec) { errors.push(`${at}.op=${op.op} 非法，允许：${Object.keys(FORESHADOW_OPS).join(' / ')}`); continue; }
    for (const need of spec.needs) {
      if (op[need] === undefined || op[need] === '') errors.push(`${at}.${need} 必填（op=${op.op}）`);
    }
    const cur = foreById.get(op.id);
    if (op.op === 'plant') {
      if (cur) { errors.push(`${at}.id=${op.id} 已存在，不能重复埋`); continue; }
      if (!Array.isArray(op.payoff_window) || op.payoff_window.length !== 2) {
        errors.push(`${at}.payoff_window 必须是 [起始章, 截止章]`);
      } else if (op.payoff_window[0] > op.payoff_window[1]) {
        errors.push(`${at}.payoff_window 起止倒置`);
      } else if (op.payoff_window[1] < ch) {
        errors.push(`${at}.payoff_window 截止章 ${op.payoff_window[1]} 早于当前章 ${ch}`);
      }
      foreById.set(op.id, {
        id: op.id,
        content: op.content,
        planted_ch: ch,
        state: 'setup',
        payoff_window: op.payoff_window,
        payoff_signal: op.payoff_signal,
        payoff_ch: null,
        evidence: '',
        history: [{ ch, op: 'plant' }],
      });
      foreUpdates.set(op.id, 'plant');
      continue;
    }
    if (!cur) { errors.push(`${at}.id=${op.id} 不存在，先 plant`); continue; }
    if (!spec.from.includes(cur.state)) {
      errors.push(`${at} ${op.id} 当前状态 ${cur.state}，不能执行 ${op.op}（只允许 ${spec.from.join('/') || '—'} → ${spec.to}）`);
      continue;
    }
    cur.state = spec.to;
    cur.history = cur.history || [];
    cur.history.push({ ch, op: op.op });
    if (op.evidence) cur.evidence = op.evidence;
    if (op.op === 'payoff') cur.payoff_ch = ch;
    if (op.op === 'fail') cur.fail_reason = op.reason;
    foreById.set(op.id, cur);
    foreUpdates.set(op.id, op.op);
  }

  // ── 5. characters ────────────────────────────────────────────
  const charUpdates = new Map();
  for (const [i, c] of (delta.characters || []).entries()) {
    const at = `characters[${i}]`;
    if (!c.id) { errors.push(`${at}.id 必填`); continue; }
    const file = P.char(c.id);
    let card = C.readJsonSafe(file, null);
    if (!card) {
      card = {
        id: c.id, name: c.name || c.id,
        stable: { motivation: '', goal: '', conflict: '', arc: '', anchors: [], lines: [] },
        state: { location: '', goal: '', relations: {}, power: '', items: [], conditions: [] },
        known: [], misbeliefs: [], forbidden_knowledge: [],
      };
      warnings.push(`${at}.id=${c.id} 是新角色，已按模板建档（记得补 stable 四要素与台词样本）。`);
    }
    if (c.state) { card.state = Object.assign({}, card.state, c.state); }
    for (const [j, k] of (c.known || []).entries()) {
      if (!k.fact_id) { errors.push(`${at}.known[${j}].fact_id 必填`); continue; }
      if (!factsById.has(k.fact_id) && !seenNew.has(k.fact_id)) {
        errors.push(`${at}.known[${j}].fact_id=${k.fact_id} 不在账本里：先在本章 facts 里登记这条事实，再让人物知道。`);
        continue;
      }
      if (!Number.isInteger(k.learned_in_ch) || k.learned_in_ch > ch) {
        errors.push(`${at}.known[${j}].learned_in_ch 必须是 ≤${ch} 的整数（不许提前知道）`);
        continue;
      }
      if (!k.how) warnings.push(`${at}.known[${j}] 缺 how：读者/审校要能看出他是怎么知道的。`);
      if (a['strict-evidence']) {
        const ev = factsById.get(k.fact_id)?.evidence || newFacts.find((x) => x.id === k.fact_id)?.evidence || '';
        if (ev && !fs.readFileSync(P.chapter(ch), 'utf8').includes(ev)) {
          errors.push(`${at}.known[${j}] 证据「${ev.slice(0, 20)}…」在本章正文里找不到（--strict-evidence）`);
        }
      }
      if (!card.known.some((x) => x.fact_id === k.fact_id)) card.known.push(k);
    }
    for (const [j, m] of (c.misbeliefs || []).entries()) {
      if (!m.belief) { errors.push(`${at}.misbeliefs[${j}].belief 必填`); continue; }
      if (!card.misbeliefs.some((x) => x.belief === m.belief)) {
        card.misbeliefs.push({ belief: m.belief, since_ch: m.since_ch || ch, corrected_in_ch: null });
      }
    }
    if (Array.isArray(c.forbidden_knowledge)) {
      card.forbidden_knowledge = Array.from(new Set([...(card.forbidden_knowledge || []), ...c.forbidden_knowledge]));
    }
    charUpdates.set(c.id, card);
  }

  // ── 6. reader_known ──────────────────────────────────────────
  const readerKnown = (delta.reader_known || []).map((r, i) => {
    if (!r.fact_id) { errors.push(`reader_known[${i}].fact_id 必填`); return null; }
    if (!factsById.has(r.fact_id) && !seenNew.has(r.fact_id)) {
      errors.push(`reader_known[${i}].fact_id=${r.fact_id} 不在账本里`);
      return null;
    }
    return { fact_id: r.fact_id, revealed_in_ch: Number.isInteger(r.revealed_in_ch) ? r.revealed_in_ch : ch };
  }).filter(Boolean);

  // ── 7. 汇总 ──────────────────────────────────────────────────
  if (errors.length) {
    C.die(`结算被拒（第 ${ch} 章，共 ${errors.length} 条）：\n- ${errors.join('\n- ')}`, 1);
  }
  for (const w of warnings) process.stderr.write(`注意：${w}\n`);

  const summary = {
    chapter: ch,
    delta,
    newFacts,
    retired,
    fore: Array.from(foreUpdates.entries()),
    chars: charUpdates,
    readerKnown,
  };

  if (a['dry-run']) {
    console.log(JSON.stringify({
      dry_run: true,
      chapter: ch,
      facts_added: newFacts.map((f) => f.id),
      facts_retired: retired.map((r) => `${r.id}@until${r.until_ch}`),
      foreshadow: summary.fore,
      characters: Array.from(charUpdates.keys()),
      reader_known: readerKnown.map((r) => r.fact_id),
    }, null, 2));
    return;
  }

  // ── 8. 落盘（先全量备份，写坏可回滚）──────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(P.craft, 'backup', stamp);
  const touched = [P.facts, P.foreshadow, P.chapterLog].concat(Array.from(charUpdates.keys()).map((id) => P.char(id)));
  for (const f of touched) {
    if (fs.existsSync(f)) {
      C.ensureDir(backupDir);
      fs.copyFileSync(f, path.join(backupDir, path.basename(f)));
    }
  }

  try {
    C.writeJsonl(P.facts, facts.concat(newFacts).map((f) => {
      const r = retired.find((x) => x.id === f.id);
      return r ? Object.assign({}, f, { valid_until_ch: r.until_ch, retired_reason: r.reason }) : f;
    }));
    C.writeJsonl(P.foreshadow, Array.from(foreById.values()));
    for (const [id, card] of charUpdates) C.writeJson(P.char(id), card);
    C.appendJsonl(P.chapterLog, {
      chapter: ch,
      summary: delta.summary,
      facts_added: newFacts.map((f) => f.id),
      facts_retired: retired.map((r) => r.id),
      foreshadow: summary.fore.map(([id, op]) => ({ id, op })),
      reader_known: readerKnown.map((r) => r.fact_id),
      at: new Date().toISOString(),
    });
    C.appendJsonl(P.settleLog, {
      at: new Date().toISOString(),
      chapter: ch,
      key,
      counts: { facts_added: newFacts.length, facts_retired: retired.length, foreshadow: summary.fore.length, characters: charUpdates.size },
    });
  } catch (e) {
    process.stderr.write(`写盘失败：${e.message}\n备份在 ${backupDir}\n`);
    process.exit(1);
  }

  console.log([
    `第 ${ch} 章已结算。`,
    `新事实 ${newFacts.length} 条${newFacts.length ? `（${newFacts.map((f) => f.id).join(' ')}）` : ''}`,
    `失效不删 ${retired.length} 条${retired.length ? `（${retired.map((r) => `${r.id}→第${r.until_ch}章止`).join(' ')}）` : ''}`,
    `伏笔 ${summary.fore.length} 处${summary.fore.length ? `（${summary.fore.map(([id, op]) => `${id}:${op}`).join(' ')}）` : ''}`,
    `角色 ${charUpdates.size} 人`,
    `读者已知 ${readerKnown.length} 条`,
  ].join(' · '));
  console.log(`下一步：node scripts/rebuild.js --book ${a.book}`);
}

main();
