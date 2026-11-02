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
const QUOTED = /[「“"]([^」”"\n]{1,400})[」”"]/g;

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

  // 0.5 规格：整章字数够不够（声明 L4+ 却写成一闪而过，是另一种掐灭）
  const MIN_CHARS = { L1: 0, L2: 800, L3: 800, L4: 1500, L5: 1500, L6: 2500 };
  const countChars = (t) => Array.from(t.replace(/\s+/g, '').replace(/[，。！？；：、“”‘’（）《》…—\-·,.!?;:"'()\[\]]/g, '')).length;
  const ct0 = C.readJsonSafe(P.contract(ch), null);
  const chLevel = (ct0 && ct0.nsfw_level) || level;
  const minChars = MIN_CHARS[chLevel] || 0;
  const chapChars = countChars(text);
  if (minChars && chapChars < minChars) {
    add('under-length', `本章 ${chapChars} 字，${chLevel} 的规格是 ${minChars} 字：补一场实的（前戏 / 第二拍 / 事后），别拿形容词注水`, '');
  }

  // 0. 模糊指代：叙述里用「那里/下面/那个地方」代指性器官 —— 把词说出来
  //    （放在最前：整章一个词库词都没命中、却通篇「那里」，恰恰是最该抓的写法）
  const proxies = lex.vague_proxies || ['那里', '那儿', '下面', '底下', '那个地方', '那地方', '私处', '下身', '那个部位'];
  const cues = lex.erotic_cues || ['热', '湿', '紧', '胀', '颤', '抖', '进', '顶', '夹', '贴', '摸', '舔', '含', '抵', '揉', '咬', '喘', '水', '肿', '麻'];
  let narr = '';
  let last = 0;
  for (const [s, e] of dialogueSpans) { narr += `${text.slice(last, s)}${'　'.repeat(e - s)}`; last = e; }
  narr += text.slice(last);
  const vagueSeen = new Set();
  for (const sen of narr.split(/[。！？；!?;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const p = proxies.find((x) => sen.includes(x));
    if (!p || vagueSeen.has(p)) continue;
    if (!cues.some((c) => sen.includes(c))) continue; // 只有情欲语境里的指代才算回避
    vagueSeen.add(p);
    add('vague-anatomy',
      `叙述用「${p}」代指（${sen.slice(0, 18)}）：把词写出来 —— 按本书语域选具体词，或直接写动作和反应，别用代称`,
      p);
  }

  const hits = [];
  for (const t of lex.terms || []) {
    let at = text.indexOf(t.term);
    while (at !== -1) {
      const inDialogue = dialogueSpans.some(([s, e]) => at >= s && at < e);
      hits.push({ ...t, at, inDialogue });
      at = text.indexOf(t.term, at + t.term.length);
    }
  }
  if (!hits.length && !issues.length) {
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

  // 3.5 换词凑数：同一部位在一章里被叫出三种以上
  const byPart = {};
  for (const h of hits) {
    if (!h.part || h.part === 'cliche' || h.part.startsWith('action') || h.part.startsWith('reaction')) continue;
    (byPart[h.part] = byPart[h.part] || new Set()).add(h.term);
  }
  for (const [part, set] of Object.entries(byPart)) {
    if (set.size >= 3) {
      add('term-rotation', `${part} 被叫出 ${set.size} 种（${[...set].join(' / ')}）：一个部位定一个词，花样靠动作和反应换，不靠换词`, [...set][0]);
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
