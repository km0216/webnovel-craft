#!/usr/bin/env node
'use strict';
// nsfw_check.js —— 情欲场景的语域检查。默认不加载；book.json 里 nsfw.enabled 才跑。
// 判的是「这个域在这本书/这场戏/这个人嘴里合不合」，不是「这个词禁不禁」。
// 永远不阻断（风格不是错误），只给 advisory；--strict 时有 advisory 就 exit 1。
//
// 用法：
//   node nsfw_check.js --book DIR --ch 12 [--json] [--strict]
// 退出码：0 = 没意见（或只报 advisory）；1 = --strict 且有 advisory；2 = 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node nsfw_check.js --book DIR --ch N [--json] [--strict]';
const LEVEL_CAP = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, L6: 5 };
const QUOTED = /[“"「]([^”"」]{1,200})[”"」]/g;

function loadLexicon(bookRoot) {
  const own = path.join(bookRoot, 'nsfw-lexicon.json');
  const def = path.resolve(__dirname, '..', 'templates', 'nsfw-lexicon.json');
  const file = fs.existsSync(own) ? own : def;
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.ch) C.die(USAGE, 2);
  const root = path.resolve(a.book);
  const P = C.bookPaths(root);
  const ch = Number(a.ch);
  const book = C.readJson(P.book);
  const nsfw = book.nsfw || {};

  if (!nsfw.enabled) {
    console.log('NSFW 模块未启用（book.json 里 nsfw.enabled 不是 true），跳过。');
    return;
  }
  if (!fs.existsSync(P.chapter(ch))) C.die(`找不到正文 ${P.chapter(ch)}`, 2);
  const text = fs.readFileSync(P.chapter(ch), 'utf8');

  const { file: lexFile, data: lex } = loadLexicon(root);
  const profileName = nsfw.profile || 'white-text';
  const profile = lex.profiles[profileName];
  if (!profile) C.die(`未知 profile「${profileName}」，可选：${Object.keys(lex.profiles).join(' / ')}`, 2);

  const level = nsfw.explicit_level || 'L3';
  const cap = LEVEL_CAP[level] || 3;
  const issues = [];
  const add = (rule, message, evidence) => issues.push({ severity: 'advisory', rule, message, evidence: evidence || '' });

  // 引号内的片段算对白，其余算叙述
  const dialogueSpans = [];
  for (const m of text.matchAll(QUOTED)) dialogueSpans.push([m.index, m.index + m[0].length]);

  const hits = [];
  for (const t of lex.terms || []) {
    let at = text.indexOf(t.term);
    while (at !== -1) {
      const inDialogue = dialogueSpans.some(([s, e]) => at >= s && at < e);
      hits.push({ ...t, at, inDialogue });
      at = text.indexOf(t.term, at + t.term.length);
    }
  }
  if (!hits.length) {
    console.log(`第 ${ch} 章（${profileName} · ${level}）：没有命中词库里的词，没什么可说的。`);
    return;
  }

  // 1. 域不匹配：叙述按 narration、对白按 dialogue 判
  const allowedNarr = new Set(profile.narration || []);
  const allowedDial = new Set(profile.dialogue || []);
  const allowedClimax = new Set((profile.climax || []).concat(profile.narration || []));
  const mainAllowed = (h) => (h.inDialogue ? allowedDial : allowedClimax);
  for (const h of hits) {
    if (h.part === 'cliche') continue;
    // scope 说了算：叙述专用词出现在对白里不算越域（人在床上说「你别磨」很正常）
    if (h.scope === 'narration' && h.inDialogue) continue;
    if (h.scope === 'dialogue' && !h.inDialogue) continue;
    if (!mainAllowed(h).has(h.register)) {
      add('register-mismatch',
        `${h.inDialogue ? '对白' : '叙述'}用了「${h.term}」（${h.register} 域），本书 ${profileName} 允许的是 ${(h.inDialogue ? [...allowedDial] : [...allowedClimax]).join('/')}`,
        h.term);
    }
  }

  // 2. 混域：同一段里同时出现两端（literary / clinical vs crude）
  const paragraphs = text.split(/\n{2,}|\n(?=第[一二三四五六七八九十\d]+章)/);
  for (const para of paragraphs) {
    const regs = new Set(hits.filter((h) => h.part !== 'cliche' && para.includes(h.term)).map((h) => h.register));
    if (regs.has('crude') && (regs.has('literary') || regs.has('clinical') || regs.has('euphemism'))) {
      add('register-mixed', `同一段里混了两端：${[...regs].join(' + ')}。一场戏一个域，混着用读者会出戏`, para.slice(0, 30));
    }
  }

  // 3. 越级：用词强度超过声明的 explicit_level
  for (const h of hits) {
    if (h.part === 'cliche') continue;
    if (h.intensity > cap) {
      add('level-exceeded', `用了「${h.term}」（强度 ${h.intensity}），但本书声明 ${level}（上限 ${cap}）`, h.term);
    }
  }

  // 4. 俗套：任何 profile 都该改，但戏仿/角色刻意说时成立
  const cliches = hits.filter((h) => h.part === 'cliche');
  if (cliches.length) {
    add('cliche', `俗套词 ${cliches.length} 处：${Array.from(new Set(cliches.map((h) => h.term))).join(' / ')}——换成具体部位 + 具体动作 + 具体反应`, cliches[0].term);
  }

  // 5. 掐灭：高尺度声明却整章含蓄，且没有事后痕迹
  const byReg = {};
  for (const h of hits) byReg[h.register] = (byReg[h.register] || 0) + 1;
  const marks = (lex.aftercare_markers || []).filter((m) => text.includes(m));
  if (['L4', 'L5', 'L6'].includes(level) && (byReg.euphemism || 0) >= 2 && marks.length === 0) {
    add('extinguished', `声明 ${level}，但整章靠含蓄词（${byReg.euphemism} 处）带过，也没有事后痕迹——这是「情欲被掐灭」的机械指纹`, '');
  }
  if (['L4', 'L5', 'L6'].includes(level) && marks.length === 0) {
    add('no-aftercare', `声明 ${level} 但找不到事后痕迹（${(lex.aftercare_markers || []).slice(0, 5).join('/')}…）：要么补，要么把 level 降下来`, '');
  }

  // 6. 对白域 vs 角色声线（只报，不判谁说的）
  const charFiles = fs.existsSync(P.charactersDir)
    ? fs.readdirSync(P.charactersDir).filter((f) => f.endsWith('.json')) : [];
  const voices = charFiles.map((f) => C.readJson(path.join(P.charactersDir, f)))
    .filter((c) => c.voice && c.voice.lexicon);
  if (voices.length) {
    const dialHits = hits.filter((h) => h.inDialogue && h.part !== 'cliche' && h.scope !== 'narration');
    const allowedRegs = new Set();
    for (const c of voices) {
      for (const r of [].concat(c.voice.lexicon)) allowedRegs.add(r);
    }
    const seen = new Set();
    for (const h of dialHits) {
      if (!allowedRegs.has(h.register)) {
        const key = `${h.term}|${h.register}`;
        if (seen.has(key)) continue; // 同一个词只报一次，别刷屏
        seen.add(key);
        add('voice-mismatch', `对白里出现「${h.term}」（${h.register}），但没有角色的 voice.lexicon 设成这个域`, h.term);
      }
    }
  }

  // 输出
  if (a.json) {
    process.stdout.write(`${JSON.stringify({
      chapter: ch, profile: profileName, level, lexicon: lexFile,
      hits: hits.length, by_register: byReg, issues,
    }, null, 2)}\n`);
  } else {
    console.log(`第 ${ch} 章情欲语域（${profileName} · ${level}）：命中 ${hits.length} 处 · ${issues.length} 条提示`);
    for (const [r, n] of Object.entries(byReg)) console.log(`  域 ${r}: ${n}`);
    for (const i of issues) console.log(`  [${i.rule}] ${i.message}`);
    if (!issues.length) console.log('  和本书的语域对得上。');
  }
  process.exit(a.strict && issues.length ? 1 : 0);
}

main();
