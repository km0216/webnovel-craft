#!/usr/bin/env node
'use strict';
// output_check.js —— 机械门总闸：正文落地前跑，零 LLM。
// 拦的是「不能让」的东西：字数窗口、指令泄漏、占位符、禁区、标点、退化、AI 句式密度。
// 判定只有两档：blocking（必须改了才准过）/ advisory（人看一眼决定）。
//
// 用法：
//   node output_check.js --book DIR --ch 12 [--json] [--no-detector]
// 退出码：0 = 无 blocking；1 = 有 blocking；2 = 用法/结构错误

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/common');

const USAGE = 'Usage: node output_check.js --book DIR --ch N [--json] [--no-detector]';

// 模型泄漏：把自己的工作过程写进正文
const LEAK = /作为一个?\s*AI|作为人工智能|作为语言模型|本章将|这一章我们|接下来我们|以下是|以上就是|我会(?:为您|为你)|希望(?:这|以上)|抱歉|我无法|不能提供|\[待|TODO|待补|占位/;
// 指令/模板残留：未替换的占位符
const PLACEHOLDER = /\{[A-Z]+:[^}]*\}|【[^】]{0,4}待[^】]{0,8}】|X{3,}|＿{2,}|\.\.\.\.\.\./;
// 叙述里的破折号（对话框里可能合理，只报不改）
const DASH = /——|--/g;

function stripMarkup(text) {
  return text.replace(/^#.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
}

function countChars(text) {
  const clean = stripMarkup(text)
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、“”‘’（）《》…—\-·,.!?;:"'()\[\]]/g, '');
  return clean.length;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.ch) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const P = C.bookPaths(root);
  const ch = Number(a.ch);
  const book = C.readJson(P.book);
  const contract = C.readJsonSafe(P.contract(ch), null);

  if (!fs.existsSync(P.chapter(ch))) C.die(`找不到正文 ${P.chapter(ch)}`, 2);
  const raw = fs.readFileSync(P.chapter(ch), 'utf8');
  const text = stripMarkup(raw);

  const issues = [];
  const add = (severity, rule, message, evidence) => issues.push({ severity, rule, message, evidence: evidence || '' });

  // ── 1. 字数窗口 ─────────────────────────────────────────────
  const win = (contract && Array.isArray(contract.word_window) && contract.word_window.length === 2)
    ? contract.word_window : (book.word_window || [0, 999999]);
  const chars = countChars(text);
  if (chars < win[0]) add('blocking', 'word-count', `正文 ${chars} 字，低于窗口 ${win[0]}（差 ${win[0] - chars}）`, '');
  if (chars > win[1]) add('advisory', 'word-count', `正文 ${chars} 字，超过窗口 ${win[1]}`, '');

  // ── 2. 指令泄漏 / 元叙述 ───────────────────────────────────
  const leak = text.match(LEAK);
  if (leak) add('blocking', 'instruction-leak', `正文里有模型/流程的痕迹：「${leak[0]}」`, leak[0]);

  // ── 3. 占位符残留 ──────────────────────────────────────────
  const ph = raw.match(PLACEHOLDER);
  if (ph) add('blocking', 'placeholder', `未替换的占位符：「${ph[0]}」`, ph[0]);

  // ── 4. 禁区 ────────────────────────────────────────────────
  for (const zone of (contract && contract.forbidden_zones) || []) {
    const key = String(zone).replace(/^不许|^不要|^禁止/, '').trim();
    if (key.length >= 2 && text.includes(key)) {
      add('blocking', 'forbidden-zone', `碰到禁区「${zone}」`, key);
    }
  }

  // ── 5/6. 必覆盖节点与必出场角色 ────────────────────────────
  // 节点不做机器判定：文学文本的措辞跟合同永远对不上字面（「他打量她」正文写的是「上下扫了她一眼」），
  // 硬匹配只会制造噪音。节点清单留在合同里给人看、给 reviewer 判（rubric 的 info_release）。
  // 这里只判能确定的那件事：合同要求的角色，名字/别名在正文里有没有出现。
  for (const id of (contract && contract.required_appearances) || []) {
    if (contract && contract.pov === id) continue;
    const file = P.char(id);
    const card = fs.existsSync(file) ? C.readJson(file) : { name: id };
    const names = [card.name, id, ...(card.aliases || [])].filter(Boolean);
    if (!names.some((n) => text.includes(n))) {
      add('advisory', 'appearance', `合同要求 ${card.name || id} 出场，正文里名字/别名都没出现`, id);
    }
  }

  // ── 6.5 小场（teaser）：书级要求时，合同必须安排 ─────────────
  // 只能判「合同里有没有安排」，判不了正文有没有写足——那归 soft review。
  if (book.require_teaser) {
    const t = contract && contract.teaser;
    if (!t || !String(t.content || '').trim()) {
      add('advisory', 'teaser-missing', '本书要求每章一大一小（sacred），本章合同没安排小场（teaser.content 空）', '');
    }
  }

  // ── 7. 破折号密度（网文正文里本来就少用）──────────────────
  const dashes = (text.match(DASH) || []).length;
  const perKilo = chars > 0 ? dashes / (chars / 1000) : 0;
  const dashMax = Number((book.thresholds && book.thresholds.em_dash_per_kchar_max) || 2);
  if (perKilo > dashMax) {
    add('advisory', 'em-dash', `叙述里破折号 ${dashes} 处（${perKilo.toFixed(1)}/千字，参考上限 ${dashMax}）`, '');
  }

  // ── 8. 退化 + AI 句式（复用两个检测器）─────────────────────
  if (!a['no-detector']) {
    const run = (script, args) => {
      const file = path.join(__dirname, script);
      if (!fs.existsSync(file)) return null;
      return spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
    };

    const deg = run('check_degeneration.js', ['--check', '--json', P.chapter(ch)]);
    if (deg && deg.stdout) {
      try {
        const j = JSON.parse(deg.stdout);
        const items = j.findings || j.issues || [];
        for (const it of items) {
          if ((it.severity || 'blocking') === 'blocking') {
            add('blocking', `degeneration:${it.type || it.rule || 'unknown'}`, it.message || JSON.stringify(it), it.excerpt || '');
          }
        }
      } catch (e) { add('advisory', 'degeneration-parse', '退化检测输出无法解析，人工看一眼', ''); }
    }

    const ai = run('check_ai_patterns.js', ['--check', '--json', '--book', root, P.chapter(ch)]);
    if (ai && ai.stdout) {
      try {
        const j = JSON.parse(ai.stdout);
        for (const it of j.findings || []) {
          add(it.severity === 'blocking' ? 'blocking' : 'advisory',
            `ai-pattern:${it.type}`, it.message, it.excerpt || '');
        }
      } catch (e) { add('advisory', 'ai-pattern-parse', 'AI 句式检测输出无法解析，人工看一眼', ''); }
    }
  }

  // ── 9. NSFW 语域（默认不跑；--nsfw 或 book.nsfw.enabled 时纳入汇总）──
  if (a.nsfw && fs.existsSync(path.join(__dirname, 'nsfw_check.js'))) {
    const r = spawnSync(process.execPath,
      [path.join(__dirname, 'nsfw_check.js'), '--book', root, '--ch', String(ch), '--json'],
      { encoding: 'utf8' });
    try {
      for (const it of (JSON.parse(r.stdout).issues || [])) {
        add('advisory', `nsfw:${it.rule}`, it.message, it.evidence || '');
      }
    } catch (e) { add('advisory', 'nsfw-parse', 'NSFW 检查输出无法解析，人工看一眼', ''); }
  }

  // ── 输出 ───────────────────────────────────────────────────
  const blocking = issues.filter((i) => i.severity === 'blocking');
  if (a.json) {
    process.stdout.write(`${JSON.stringify({ chapter: ch, chars, window: win, blocking: blocking.length, issues }, null, 2)}\n`);
  } else {
    console.log(`第 ${ch} 章机械门：${chars} 字（窗口 ${win[0]}–${win[1]}）· ${issues.length} 条（blocking ${blocking.length}）`);
    for (const i of issues) console.log(`  [${i.severity}] ${i.rule}: ${i.message}`);
    if (!issues.length) console.log('  干净。');
  }
  process.exit(blocking.length ? 1 : 0);
}

main();
