#!/usr/bin/env node
'use strict';
// rebuild.js —— 从账本重建派生视图（state/context.md 与 state/knowledge.json）。
// 派生视图禁手改：改了就下次被覆盖。唯一权威是 canon/facts.jsonl + characters + ledger。
//
// 用法：
//   node rebuild.js --book DIR [--ch N] [--max-kb 8]
//   --ch 省略时取「已结算的最后一章 + 1」
// 退出码：0 = 已重建；1 = 书结构有问题

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node rebuild.js --book DIR [--ch N] [--max-kb 8]';

function volumeOf(book, ch) {
  const starts = book.volume_starts || [1];
  let v = 1;
  starts.forEach((s, i) => { if (ch >= s) v = i + 1; });
  return v;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const P = C.bookPaths(root);
  if (!fs.existsSync(P.book)) C.die(`找不到 ${P.book}`, 2);

  const book = C.readJson(P.book);
  const maxKb = Number(a['max-kb'] || 8);

  const facts = C.readJsonl(P.facts);
  const fore = C.readJsonl(P.foreshadow);
  const log = C.readJsonl(P.chapterLog);

  const lastCh = log.length ? Math.max(...log.map((r) => r.chapter)) : 0;
  const target = Number(a.ch) || lastCh + 1;
  const vol = volumeOf(book, target);
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };

  // ── 有效事实：时间 + 可见性双闸 ───────────────────────────────
  const activeFacts = facts.filter((f) => {
    if (f.canon_status !== 'canon') return false;
    if (f.valid_from_ch > target) return false;
    if (f.valid_until_ch !== null && f.valid_until_ch !== undefined && f.valid_until_ch < target) return false;
    if ((f.visible_from_volume || 1) > vol) return false; // 剧透闸：还没到公开的卷
    return true;
  });
  const withheld = facts.filter((f) => f.canon_status === 'canon'
    && (f.visible_from_volume || 1) > vol
    && (f.valid_until_ch === null || f.valid_until_ch === undefined || f.valid_until_ch >= target));

  // ── 角色 ────────────────────────────────────────────────────
  const charFiles = fs.existsSync(P.charactersDir)
    ? fs.readdirSync(P.charactersDir).filter((f) => f.endsWith('.json')) : [];
  const chars = charFiles.map((f) => C.readJson(path.join(P.charactersDir, f)))
    .sort((a, b) => (b.role === 'protagonist') - (a.role === 'protagonist'));
  const factsById = new Map(facts.map((f) => [f.id, f]));

  // ── 伏笔：活跃 + 逾期置顶 ────────────────────────────────────
  const openFore = fore.filter((f) => ['setup', 'hinted', 'pending_payoff'].includes(f.state));
  const overdue = openFore.filter((f) => f.payoff_window && f.payoff_window[1] < target);
  const dueSoon = openFore.filter((f) => f.payoff_window && f.payoff_window[1] >= target
    && f.payoff_window[1] <= target + 3);
  const noSignal = openFore.filter((f) => !f.payoff_signal);

  // ── 承诺：上一章合同 ────────────────────────────────────────
  const prevCh = target - 1;
  const prevContract = prevCh >= 1 ? C.readJsonSafe(P.contract(prevCh), null) : null;
  const commitments = (prevContract && prevContract.next_chapter_commitments) || [];

  // ── 近章速记 ────────────────────────────────────────────────
  const recent = log.filter((r) => r.chapter < target).sort((x, y) => y.chapter - x.chapter).slice(0, 3);

  // ── 风险 ────────────────────────────────────────────────────
  if (overdue.length) warn(`${overdue.length} 处伏笔已过兑现窗口：${overdue.map((f) => `${f.id}(${f.payoff_window[1]} 章截止)`).join(' ')}`);
  if (noSignal.length) warn(`${noSignal.length} 处伏笔没有 payoff_signal：${noSignal.map((f) => f.id).join(' ')}`);
  if (dueSoon.length) warn(`${dueSoon.length} 处伏笔 3 章内到期：${dueSoon.map((f) => `${f.id}(${f.payoff_window[1]})`).join(' ')}`);
  const missingCh = log.filter((r) => !fs.existsSync(P.chapter(r.chapter))).map((r) => r.chapter);
  if (missingCh.length) {
    // 压成区间：1–50 比列 50 个号好读
    const parts = [];
    let s = missingCh[0];
    let p = s;
    for (const n of missingCh.slice(1)) {
      if (n === p + 1) { p = n; continue; }
      parts.push(s === p ? `${s}` : `${s}–${p}`);
      s = n; p = n;
    }
    parts.push(s === p ? `${s}` : `${s}–${p}`);
    warn(`已结算但正文缺失：第 ${parts.join('、')} 章（共 ${missingCh.length} 章）`);
  }
  const protagonists = chars.filter((c) => c.role === 'protagonist');
  if (protagonists.length && target > 6) {
    for (const c of protagonists) {
      const windowCh = [target - 5, target - 1].filter((n) => n >= 1);
      const seemed = windowCh.some((n) => {
        const ct = C.readJsonSafe(P.contract(n), null);
        return ct && (ct.required_appearances || []).includes(c.id);
      });
      if (!seemed) warn(`主角 ${c.name || c.id} 最近 5 章合同里都没要求出场`);
    }
  }
  if (!chars.length) warn('还没有角色卡：写前至少建主角一张（canon/characters/）。');

  // ── 组 Markdown（七栏，按预算裁剪）────────────────────────────
  const KB = 1024;
  const limit = maxKb * KB;
  const factLine = (f) => `- ${f.id}｜${f.subj}·${f.pred}·${f.obj}（第 ${f.valid_from_ch} 章起${f.valid_until_ch != null ? `，至第 ${f.valid_until_ch} 章` : ''}）`;

  function render(opts) {
    const L = [];
    L.push(`# 上下文 · 第 ${target} 章（第 ${vol} 卷）`);
    L.push('');
    L.push(`> 由 rebuild.js 生成于 ${new Date().toISOString()}。禁手改；要改状态去改账本再重建。`);
    L.push('');
    L.push('## 1. 当前位置');
    if (prevCh >= 1) L.push(`- 上一章：第 ${prevCh} 章${log.some((r) => r.chapter === prevCh) ? '（已结算）' : '（未结算）'}`);
    else L.push('- 这是全书第一章');
    L.push(`- 本章合同：${fs.existsSync(P.contract(target)) ? 'plan/ch/ 里有' : '**缺**（先写合同再动笔）'}`);
    L.push('');
    L.push('## 2. 长期约束（不可推翻）');
    const sacred = book.sacred || [];
    if (sacred.length) sacred.slice(0, opts.sacredMax).forEach((s) => L.push(`- ${s}`));
    else L.push('- （book.json 未定义 sacred）');
    if (sacred.length > opts.sacredMax) L.push(`- …另有 ${sacred.length - opts.sacredMax} 条（预算所限未列全）`);
    L.push('');
    L.push('## 3. 角色（稳定人设不在这里，看 canon/characters/）');
    if (!chars.length) L.push('- （无）');
    for (const c of chars.slice(0, opts.charMax)) {
      const st = c.state || {};
      const parts = [
        st.location && `位置:${st.location}`,
        st.goal && `目标:${st.goal}`,
        st.power && `境界:${st.power}`,
        Array.isArray(st.items) && st.items.length && `持有:${st.items.join('/')}`,
        Array.isArray(st.conditions) && st.conditions.length && `状态:${st.conditions.join('/')}`,
      ].filter(Boolean);
      L.push(`- **${c.name || c.id}**（${c.id}）${parts.length ? `｜${parts.join('｜')}` : ''}`);
      if (c.known && c.known.length) {
        const ks = c.known.slice(-opts.knownMax).map((k) => {
          const f = factsById.get(k.fact_id);
          const dead = f && f.valid_until_ch !== null && f.valid_until_ch !== undefined && f.valid_until_ch < target;
          return `${k.fact_id}@${k.learned_in_ch}${dead ? '（已过时）' : ''}`;
        });
        L.push(`  - 已知: ${ks.join(' ')}${c.known.length > opts.knownMax ? ` …共 ${c.known.length} 条` : ''}`);
      }
      if (c.misbeliefs && c.misbeliefs.length) {
        L.push(`  - **错信**: ${c.misbeliefs.map((m) => m.belief).join('；')}`);
      }
      if (c.forbidden_knowledge && c.forbidden_knowledge.length) {
        L.push(`  - 禁区（不许他知道）: ${c.forbidden_knowledge.join(' ')}`);
      }
    }
    if (chars.length > opts.charMax) L.push(`- …另有 ${chars.length - opts.charMax} 人`);
    L.push('');
    L.push('## 4. 活跃伏笔（逾期置顶）');
    if (!openFore.length) L.push('- （无）');
    for (const f of overdue.concat(dueSoon, openFore.filter((x) => !overdue.includes(x) && !dueSoon.includes(x)))) {
      const tag = overdue.includes(f) ? '**【逾期】**' : dueSoon.includes(f) ? '**（将到期）**' : '';
      L.push(`- ${tag}${f.id}｜${f.content}｜窗口 ${f.payoff_window ? f.payoff_window.join('–') : '?'}｜当前 ${f.state}${f.payoff_signal ? `｜回收信号：${f.payoff_signal}` : '｜**缺回收信号**'}`);
    }
    L.push('');
    L.push('## 5. 近章速记');
    if (!recent.length) L.push('- （还没结算过任何章）');
    for (const r of recent) L.push(`- 第 ${r.chapter} 章：${r.summary}`);
    L.push('');
    L.push('## 6. 下一章承诺（上章合同许下的）');
    if (!commitments.length) L.push('- （无；上章没留承诺或没有合同）');
    for (const c of commitments.slice(0, opts.commitMax)) L.push(`- ${c}`);
    L.push('');
    L.push('## 7. 连贯性风险');
    if (!warnings.length) L.push('- （无）');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
    L.push('## 附：当前有效事实');
    if (!activeFacts.length) L.push('- （无）');
    for (const f of activeFacts.slice(0, opts.factMax)) {
      L.push(opts.withEvidence ? `${factLine(f)}｜证据「${f.evidence || '—'}」` : factLine(f));
    }
    if (activeFacts.length > opts.factMax) L.push(`- …另有 ${activeFacts.length - opts.factMax} 条（第 8 节截断，需要时先跑 continuity_check）`);
    if (withheld.length) {
      L.push('');
      L.push(`> 另有 ${withheld.length} 条事实被剧透闸挡住（visible_from_volume > ${vol}），不注入。`);
    }
    return L.join('\n') + '\n';
  }

  // 预算：先全量，超了按顺序砍 —— 长期约束明细 → 证据 → 事实/角色条数 → 近章速记
  const ladder = [
    { sacredMax: 50, charMax: 40, knownMax: 99, factMax: 999, commitMax: 99, withEvidence: true },
    { sacredMax: 20, charMax: 20, knownMax: 9, factMax: 60, commitMax: 12, withEvidence: false },
    { sacredMax: 10, charMax: 12, knownMax: 5, factMax: 30, commitMax: 8, withEvidence: false },
    { sacredMax: 6, charMax: 8, knownMax: 3, factMax: 15, commitMax: 5, withEvidence: false },
  ];
  let text = '';
  let used = ladder[ladder.length - 1];
  for (const opts of ladder) {
    text = render(opts);
    used = opts;
    if (Buffer.byteLength(text, 'utf8') <= limit) break;
  }
  const size = Buffer.byteLength(text, 'utf8');
  if (size > limit) warn(`上下文仍超预算（${C.fmtBytes(size)} > ${maxKb} KB）：先砍伏笔与角色，别砍禁区`);

  // ── knowledge.json：三视角快照 ───────────────────────────────
  const readerKnown = new Set();
  for (const r of log.filter((x) => x.chapter < target)) {
    (r.reader_known || []).forEach((id) => readerKnown.add(id));
  }
  const knowledge = {
    generated_for_chapter: target,
    volume: vol,
    objective_facts: activeFacts.map((f) => ({
      id: f.id, subj: f.subj, pred: f.pred, obj: f.obj,
      from_ch: f.valid_from_ch, until_ch: f.valid_until_ch ?? null, source_ch: f.source_ch,
    })),
    withheld_from_reader: withheld.map((f) => f.id),
    characters: Object.fromEntries(chars.map((c) => [c.id, {
      name: c.name || c.id,
      known: (c.known || []).filter((k) => k.learned_in_ch < target).map((k) => k.fact_id),
      misbeliefs: (c.misbeliefs || []).filter((m) => m.since_ch < target).map((m) => m.belief),
      forbidden: c.forbidden_knowledge || [],
    }])),
    reader_known: Array.from(readerKnown),
    open_foreshadow: openFore.map((f) => ({ id: f.id, state: f.state, window: f.payoff_window })),
    overdue: overdue.map((f) => f.id),
    warnings,
  };

  C.ensureDir(P.state);
  C.writeTextAtomic(P.context, text);
  C.writeJson(P.knowledge, knowledge);

  console.log([
    `第 ${target} 章上下文已重建（第 ${vol} 卷）`,
    `context.md ${C.fmtBytes(size)}${size > limit ? ' **超预算**' : ''}`,
    `有效事实 ${activeFacts.length} · 挡住 ${withheld.length} · 角色 ${chars.length} · 活跃伏笔 ${openFore.length}（逾期 ${overdue.length}）`,
    `风险 ${warnings.length} 条`,
  ].join(' · '));
  if (warnings.length) for (const w of warnings) console.log(`  ! ${w}`);
}

main();
