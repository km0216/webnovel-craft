#!/usr/bin/env node
'use strict';
// continuity_check.js —— 连贯性不变量检查。零 LLM，只读账本与本文件。
// 原则：blocking 只在「100% 确定」时触发；拿不准的一律 advisory。宁可漏，不可误杀。
//
// 用法：
//   node continuity_check.js --book DIR --ch 12 [--json]
// 退出码：0 = 无 blocking；1 = 有 blocking；2 = 用法/结构错误

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node continuity_check.js --book DIR --ch N [--json]';

// 从「余额」类事实里抠数字：「余额 -3」「剩 120 灵石」
const MONEY_PRED = /余额|钱|灵石|金币|银两|存款|资产|积分|点数/;
const HOLD_PRED = /持有|拿着|在手|揣着/;
const PLACE_PRED = /位于|处在|住在|在/;

function numOf(s) {
  const m = String(s).replace(/[,，]/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.ch) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const P = C.bookPaths(root);
  const ch = Number(a.ch);
  const book = C.readJson(P.book);

  const facts = C.readJsonl(P.facts);
  const fore = C.readJsonl(P.foreshadow);
  const log = C.readJsonl(P.chapterLog);
  const charFiles = fs.existsSync(P.charactersDir)
    ? fs.readdirSync(P.charactersDir).filter((f) => f.endsWith('.json')) : [];
  const chars = charFiles.map((f) => C.readJson(path.join(P.charactersDir, f)));

  const text = fs.existsSync(P.chapter(ch)) ? fs.readFileSync(P.chapter(ch), 'utf8') : '';
  const contract = C.readJsonSafe(P.contract(ch), null);

  const issues = [];
  const add = (level, rule, msg, evidence) => issues.push({ severity: level, rule, message: msg, evidence: evidence || '' });

  const active = (f, n) => f.canon_status === 'canon'
    && f.valid_from_ch <= n
    && (f.valid_until_ch === null || f.valid_until_ch === undefined || f.valid_until_ch >= n);

  // ── 0. 视角人物必须有卡：合同 pov 对不上任何角色卡，等于写手无据可依 ──
  if (contract && contract.pov) {
    const povId = String(contract.pov);
    const known = new Set(chars.map((c) => c.id));
    const aliases = new Set(['first', 'third', 'third-limited', 'omniscient', 'he', 'she']);
    if (!known.has(povId) && !aliases.has(povId)) {
      add('advisory', 'pov-no-card',
        `合同 pov=${povId} 没有对应的角色卡：给他建一张（人物卡是写手唯一的语感依据）`,
        '');
    }
  }

  // ── 1. 视角泄漏：角色不该知道的事出现在本章 ──────────────────
  for (const c of chars) {
    for (const fid of (c.forbidden_knowledge || [])) {
      const f = facts.find((x) => x.id === fid && active(x, ch));
      if (!f || !text) continue;
      const needle = String(f.obj || '').trim();
      if (needle.length < 4) continue; // 太短的关键词必然误报
      if (text.includes(needle)) {
        add('blocking', 'knowledge-leak',
          `${c.name || c.id} 不该知道 ${fid}「${f.subj}·${f.pred}·${f.obj}」，但正文出现了「${needle}」`,
          needle);
      }
    }
  }

  // ── 2. 死人不动 ─────────────────────────────────────────────
  const dead = chars.filter((c) => c.dead || (c.state && c.state.dead));
  for (const c of dead) {
    const names = [c.name, c.id].filter(Boolean);
    if (contract && (contract.required_appearances || []).includes(c.id)) {
      add('blocking', 'dead-appearance', `${c.name || c.id} 已标记死亡，本章合同仍要求他出场`, '');
    } else if (text && names.some((n) => text.includes(n))) {
      add('advisory', 'dead-in-text', `${c.name || c.id} 已死亡但正文提到他：确认是回忆/转述，不是复活动作`, '');
    }
  }

  // ── 3. 资产非负 ─────────────────────────────────────────────
  for (const f of facts.filter((x) => active(x, ch) && MONEY_PRED.test(x.pred))) {
    const n = numOf(f.obj);
    if (n !== null && n < 0) {
      add('blocking', 'negative-asset', `${f.subj} 的${f.pred} = ${f.obj}（第 ${f.valid_from_ch} 章起）为负`, f.evidence || '');
    }
  }

  // ── 4. 唯一道具同时被两人持有 / 两处出现 ────────────────────
  const owners = new Map();
  for (const c of chars) {
    for (const item of (c.state && Array.isArray(c.state.items) ? c.state.items : [])) {
      const key = String(item).trim();
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(c.name || c.id);
    }
  }
  for (const [item, who] of owners) {
    if (who.length > 1) {
      add('blocking', 'unique-item', `「${item}」同时被 ${who.join(' / ')} 持有（唯一道具不能分身）`, '');
    }
  }
  const uniqueItemFacts = facts.filter((x) => active(x, ch) && HOLD_PRED.test(x.pred) && x.cardinality === 'single');
  const byObj = new Map();
  for (const f of uniqueItemFacts) {
    const k = String(f.obj).trim();
    if (!byObj.has(k)) byObj.set(k, []);
    byObj.get(k).push(f.subj);
  }
  for (const [obj, subs] of byObj) {
    if (new Set(subs).size > 1) {
      add('blocking', 'unique-item', `「${obj}」的持有者出现 ${Array.from(new Set(subs)).join(' / ')}（single 事实不允许两个主体）`, '');
    }
  }

  // ── 5. 境界单调（book.json 给了 power_ladder 才检查）─────────
  const ladder = Array.isArray(book.power_ladder) ? book.power_ladder : null;
  if (ladder) {
    const idx = (v) => ladder.findIndex((x) => String(v || '').includes(x));
    for (const c of chars) {
      const seq = facts.filter((f) => active(f, ch) && f.subj === (c.name || c.id) && /境界|修为|等级|阶/.test(f.pred))
        .sort((x, y) => x.valid_from_ch - y.valid_from_ch);
      let prev = -1;
      for (const f of seq) {
        const i = idx(f.obj);
        if (i < 0) continue;
        if (i < prev) {
          add('blocking', 'realm-regress', `${c.name || c.id} 的境界从 ${ladder[prev]} 退到 ${f.obj}（第 ${f.valid_from_ch} 章）且无解释`, f.evidence || '');
        }
        prev = Math.max(prev, i);
      }
    }
  }

  // ── 6. 时间单调（合同写了 day 才检查）───────────────────────
  if (contract && Number.isFinite(contract.day)) {
    const prev = C.readJsonSafe(P.contract(ch - 1), null);
    if (prev && Number.isFinite(prev.day) && contract.day < prev.day) {
      add('blocking', 'time-regress', `第 ${ch} 章 day=${contract.day} 早于第 ${ch - 1} 章的 day=${prev.day}（闪回请在合同里标出）`, '');
    }
  }

  // ── 7. 幽灵地点 ─────────────────────────────────────────────
  // 地点一旦存在就不会因为事实失效而消失（房子还在），所以这里用全量事实
  const knownPlaces = new Set(Array.isArray(book.locations) ? book.locations : []);
  for (const f of facts.filter((x) => PLACE_PRED.test(x.pred))) knownPlaces.add(String(f.obj));
  for (const c of chars) if (c.state && c.state.location) knownPlaces.add(String(c.state.location));
  for (const c of chars) {
    const loc = c.state && c.state.location;
    if (loc && knownPlaces.size && !Array.from(knownPlaces).some((p) => String(loc).includes(p) || p.includes(String(loc)))) {
      add('advisory', 'ghost-location', `${c.name || c.id} 的位置「${loc}」对不上任何地点事实/设定`, String(loc));
    }
  }

  // ── 8/9. 伏笔：逾期与无信号 ─────────────────────────────────
  for (const f of fore) {
    const open = ['setup', 'hinted', 'pending_payoff'].includes(f.state);
    if (!open) continue;
    if (!f.payoff_signal) {
      add('blocking', 'fore-no-signal', `伏笔 ${f.id} 没有回收信号（payoff_signal）：埋了收不了`, f.content || '');
    }
    if (Array.isArray(f.payoff_window) && f.payoff_window[1] < ch) {
      const over = ch - f.payoff_window[1];
      add(over >= 3 ? 'blocking' : 'advisory', 'fore-overdue',
        `伏笔 ${f.id} 已过兑现窗口 ${over} 章（截止 ${f.payoff_window[1]}，当前 ${ch}）`, f.content || '');
    }
  }

  // ── 10. 承诺未承接（关键词袋：措辞不同不算丢）──────────────
  const prevContract = C.readJsonSafe(P.contract(ch - 1), null);
  const promises = (prevContract && prevContract.next_chapter_commitments) || [];
  if (promises.length && contract) {
    const hay = `${JSON.stringify(contract)}${text}`;
    for (const p of promises) {
      const bag = String(p).split(/[，。；：、！？\s（）()「」“”·—]/).map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 8);
      const hit = bag.length ? bag.filter((w) => hay.includes(w)).length / bag.length : hay.includes(String(p).slice(0, 6));
      if (hit < 0.34) {
        add('advisory', 'promise-dropped', `上一章许下的「${p}」在本章合同和正文里都找不到承接`, p);
      }
    }
  }

  // ── 11. 状态线索断掉 ────────────────────────────────────────
  for (const c of chars) {
    for (const cond of (c.state && Array.isArray(c.state.conditions) ? c.state.conditions : [])) {
      const key = String(cond).replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
      if (key.length >= 3 && text && contract && JSON.stringify(contract).includes(c.id) && !text.includes(key)) {
        add('advisory', 'condition-dropped', `${c.name || c.id} 的持续状态「${key}」本章该出现未出现`, key);
      }
    }
  }

  // ── 12. 主角缺席 ────────────────────────────────────────────
  const prot = chars.find((c) => c.role === 'protagonist');
  if (prot && contract && !(contract.required_appearances || []).includes(prot.id)) {
    const recent = log.filter((r) => r.chapter > ch - 6 && r.chapter < ch);
    const mentioned = recent.some((r) => JSON.stringify(r).includes(prot.id) || JSON.stringify(r).includes(prot.name));
    if (!mentioned) add('advisory', 'protagonist-absent', `主角 ${prot.name || prot.id} 连续 5 章以上没出现`, '');
  }

  // ── 14. 名字冲突 ────────────────────────────────────────────
  const nameMap = new Map();
  for (const c of chars) {
    for (const n of [c.name, ...(c.aliases || [])].filter(Boolean)) {
      if (!nameMap.has(n)) nameMap.set(n, []);
      nameMap.get(n).push(c.id);
    }
  }
  for (const [n, ids] of nameMap) {
    if (new Set(ids).size > 1) add('advisory', 'name-collision', `「${n}」被 ${Array.from(new Set(ids)).join(' / ')} 共用`, n);
  }

  // ── 输出 ────────────────────────────────────────────────────
  const blocking = issues.filter((i) => i.severity === 'blocking');
  if (a.json) {
    process.stdout.write(`${JSON.stringify({ chapter: ch, blocking: blocking.length, issues }, null, 2)}\n`);
  } else {
    console.log(`第 ${ch} 章连贯性检查：${issues.length} 条（blocking ${blocking.length}）`);
    for (const i of issues) console.log(`  [${i.severity}] ${i.rule}: ${i.message}`);
    if (!issues.length) console.log('  没发现问题。');
    if (!text) console.log(`  注意：正文 ${path.basename(P.chapter(ch))} 不存在，只做了账本检查。`);
  }
  process.exit(blocking.length ? 1 : 0);
}

main();
