#!/usr/bin/env node
'use strict';
// char_check.js —— 角色卡机械门：结构不全不许开写（judge 不了好坏，只堵漏项）。
// 用法：
//   node char_check.js --book <书> [--id <角色id>] [--json]
// 退出码：0 通过 / 1 有 blocking / 2 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node char_check.js --book DIR [--id ID] [--json]';
const ROLES = ['protagonist', 'supporting', 'antagonist', 'foil'];
const FUNCTIONS = ['主角', '施压者', '看客', '认可者', '护短者', '嘴替', '搭档', '镜像对照', '宿敌', '牺牲者', '导师', '情报源'];
const PLACEHOLDERS = [
  '角色名', 'char_id', '一句话：他是谁', '一句话记忆点：遮住名字也认得出',
  '三句以内，只写读者会反复看到的',
  '第一次 / 有过几段 / 只有过自己', '谁先动手、动完怎么解释', '开场条件：她要先确认什么才肯开始',
  '节律：挑衅 → 被按住 → 破防 → 回弹', '身体先于嘴的信号', '敏感点，按触发顺序排',
  '语言衰减曲线：开始说什么', '死线：说了就停、做了就下床的事', '事后第一件事',
  '成年身体的具体写法', '场景骨架：在哪、谁先、进到哪一步',
  '触发（什么时候）', '反应（做什么，不是形容词）', '行为锚点 1', '行为锚点 2',
  '台词样本 1', '台词样本 2', '台词样本 3',
  '句子长短 / 语速 / 断句习惯', '口头禅或标志用词（少而准）',
  '被打断时怎么反应', '紧张时的填充词',
  '驱动他的东西（情感层', '这一卷他要拿到什么', '嘴上说的目标（读者第一眼看到的）',
  '自己都不承认的需要', '怕失去什么', '谁会用什么拿捏他',
  '不想让谁知道什么；没有就写 null', '揭开后谁的态度会变、怎么变',
  '内在冲突：两个都要，只能选一个', '从 A 变成 B',
];

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function filled(v) { return text(v).length > 0; }
function len(s) { return Array.from(text(s)).length; }

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book) C.die(USAGE, 2);
  const P = C.bookPaths(path.resolve(a.book));
  if (!fs.existsSync(P.charactersDir)) C.die(`没有 canon/characters/：${P.charactersDir}`, 2);

  const book = C.readJsonSafe(P.book, {});
  const nsfw = Boolean(book.nsfw && book.nsfw.enabled);
  const files = fs.readdirSync(P.charactersDir).filter((f) => f.endsWith('.json'));
  if (!files.length) C.die('一张角色卡都没有：先 new_char.js 建一张', 1);

  const cards = files.map((f) => ({
    file: path.join(P.charactersDir, f),
    stem: f.replace(/\.json$/, ''),
    data: C.readJson(path.join(P.charactersDir, f)),
  })).filter((c) => !a.id || c.data.id === a.id || c.stem === a.id);

  const rows = [];
  const fnCount = new Map();
  const hooks = new Map();
  const voices = [];
  for (const c of cards) {
    const d = c.data;
    if (filled(d.function)) fnCount.set(d.function, (fnCount.get(d.function) || 0) + 1);
    if (filled(d.memory_hook)) {
      const k = text(d.memory_hook);
      hooks.set(k, (hooks.get(k) || 0) + 1);
    }
    // 声线画像：拿卡里自己的台词量（lines + sparring），不碰正文
    const sp0 = (d.stable && d.stable.speech) || {};
    const own = (Array.isArray(d.stable && d.stable.lines) ? d.stable.lines : [])
      .concat(Array.isArray(sp0.sparring) ? sp0.sparring : [])
      .map((s) => text(s).replace(/^[「“]|[」”]$/g, ''))
      .filter(Boolean);
    if (own.length >= 3) {
      const lens = own.map((s) => Array.from(s).length);
      voices.push({
        id: d.id, name: d.name || d.id,
        avg: lens.reduce((x, y) => x + y, 0) / lens.length,
        short: lens.filter((n) => n <= 6).length / lens.length,
      });
    }
  }

  for (const c of cards) {
    const d = c.data;
    const s = d.stable || {};
    const sp = s.speech || {};
    const rel = path.relative(P.root, c.file);
    const add = (level, field, msg) => rows.push({ level, file: rel, field, msg });
    const need = (field, v, hint) => {
      if (!filled(v)) add('BLOCK', field, `缺失：${hint}`);
    };

    // ── 身份块 ──
    if (text(d.id) !== c.stem) add('BLOCK', 'id', `与文件名不一致（文件名 ${c.stem}）`);
    need('name', d.name, '写名字');
    if (!ROLES.includes(d.role)) add('BLOCK', 'role', `必须是 ${ROLES.join(' / ')}`);
    if (!filled(d.function)) add('BLOCK', 'function', '写功能位（施压者 / 看客 / 嘴替 …）');
    else if (!FUNCTIONS.includes(d.function) && d.role !== 'protagonist') add('WARN', 'function', `非标准功能位「${d.function}」`);
    need('oneline', d.oneline, '一句话说清他是谁、在干什么');
    if (len(d.oneline) > 60) add('WARN', 'oneline', `超过 60 字（${len(d.oneline)}）`);
    need('memory_hook', d.memory_hook, '一句话记忆点');
    if (len(d.memory_hook) > 40) add('WARN', 'memory_hook', `超过 40 字（${len(d.memory_hook)}）`);
    need('appearance', d.appearance, '三句以内：体型 / 一个显眼特征 / 一个习惯留下的痕迹');

    const age = Number(d.age);
    const adultCard = nsfw || d.nsfw === true;
    if (!Number.isInteger(age) || age <= 0) {
      add(adultCard ? 'BLOCK' : 'WARN', 'age', '写整数年龄；成人向书必填');
    } else if (adultCard && age < 18) {
      add('BLOCK', 'age', `年龄 ${age} < 18：成人向卡里角色必须成年，换设定，不换算法`);
    }
    if (filled(d.age) && !filled(d.age_basis)) add('WARN', 'age_basis', '写年龄依据（学级 / 职业 / 生日），免得后面漂');

    // ── 动机五问 ──
    need('stable.motivation', s.motivation, '情感层驱动，不是「要变强」');
    need('stable.goal', s.goal, '这一卷要拿到什么');
    need('stable.surface_want', s.surface_want, '嘴上说的目标');
    need('stable.deep_need', s.deep_need, '自己不承认的需要');
    need('stable.fear', s.fear, '怕失去什么');
    need('stable.leverage', s.leverage, '谁会用什么拿捏他');
    need('stable.conflict', s.conflict, '两个都要，只能选一个');
    need('stable.arc', s.arc, '从 A 变成 B；平弧也要写清改变了谁');

    if (filled(s.surface_want) && text(s.surface_want) === text(s.deep_need)) {
      add('BLOCK', 'stable.deep_need', '和 surface_want 写成同一句：两格必须错开');
    }
    if (filled(s.deep_need) && text(s.deep_need) === text(s.conflict)) {
      add('WARN', 'stable.conflict', '和 deep_need 同句，冲突被压平');
    }

    // ── 秘密 ──
    if (!('secret' in s)) add('BLOCK', 'stable.secret', '必须显式写：内容，或 null');
    else if (filled(s.secret) && !filled(s.secret_if_revealed)) {
      add('BLOCK', 'stable.secret_if_revealed', '有秘密就要写清揭开后谁的态度变');
    }

    // ── 行为 / 锚点 ──
    const beh = Array.isArray(s.behaviors) ? s.behaviors : [];
    if (beh.length < 3) add('BLOCK', 'stable.behaviors', `至少 3 条「触发 → 反应」，现有 ${beh.length}`);
    beh.forEach((b, i) => {
      if (!filled(b && b.trigger)) add('BLOCK', `stable.behaviors[${i}].trigger`, '触发条件空着');
      if (!filled(b && b.reaction)) add('BLOCK', `stable.behaviors[${i}].reaction`, '反应空着；写动作，不写形容词');
      if (b && filled(b.trigger) && text(b.trigger) === text(b.reaction)) add('WARN', `stable.behaviors[${i}]`, '触发与反应同句');
    });

    const anchors = Array.isArray(s.anchors) ? s.anchors.filter(filled) : [];
    if (anchors.length < 2) add('BLOCK', 'stable.anchors', `至少 2 条（不会做 / 逼急了会做），现有 ${anchors.length}`);

    // ── 台词 ──
    const lines = Array.isArray(s.lines) ? s.lines.map(text).filter(Boolean) : [];
    if (lines.length < 3) add('BLOCK', 'stable.lines', `至少 3 条台词样本，现有 ${lines.length}`);
    if (new Set(lines).size !== lines.length) add('BLOCK', 'stable.lines', '有重复台词');

    // ── 说话方式 ──
    need('stable.speech.sentence', sp.sentence, '句子长短 / 语速 / 断句');
    need('stable.speech.tic', sp.tic, '口头禅或标志用词');
    need('stable.speech.interrupt', sp.interrupt, '被打断时怎么反应（咽回去 / 抢回来 / 干脆不说）');
    if (!filled(sp.filler)) add('WARN', 'stable.speech.filler', '紧张时的填充词空着（一章只用一次）');
    const spar = Array.isArray(sp.sparring) ? sp.sparring.filter(filled) : [];
    if (spar.length < 3) add('WARN', 'stable.speech.sparring', '推挡样本不足三句：一句「A 说 → B 顶回来 → A 改口」，光有各自的金句构不成对话');
    const rels = Array.isArray(sp.by_relation) ? sp.by_relation : [];
    if (rels.length < 2) add('BLOCK', 'stable.speech.by_relation', `至少 2 组「对谁 → 什么语气」，现有 ${rels.length}`);
    rels.forEach((r, i) => {
      if (!filled(r && r.to)) add('BLOCK', `stable.speech.by_relation[${i}].to`, '对象空着');
      if (!filled(r && r.tone)) add('BLOCK', `stable.speech.by_relation[${i}].tone`, '语气空着');
    });

    // ── 兑现表 ──
    const pay = Array.isArray(s.payoffs) ? s.payoffs.filter((p) => p && filled(p.what)) : [];
    if (d.role === 'protagonist' || d.role === 'antagonist') {
      if (!pay.some((p) => p.kind === '预告')) add('BLOCK', 'stable.payoffs', '缺「预告」：读者要提前知道在等什么');
      if (!pay.some((p) => p.kind === '大兑现')) add('BLOCK', 'stable.payoffs', '缺「大兑现」：预告了不收，读者会觉得被吊着');
    } else if (!pay.length) {
      add('WARN', 'stable.payoffs', '配角没排兑现：只为主角服务，读者不会心疼他');
    }

    // ── 情欲卡（成人向书才查；性是节律不是清单）──
    const hasIntimacy = d.nsfw === true;
    if (nsfw && hasIntimacy) {
      const im = d.intimacy || {};
      const arr = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
      need('intimacy.initiative', im.initiative, '谁先动手、动完怎么解释');
      need('intimacy.aftercare', im.aftercare, '事后第一件事');
      need('intimacy.lexicon_drop', im.lexicon_drop, '语言衰减曲线：开始 → 中途 → 最后');
      if (!arr(im.rhythm).length) add('BLOCK', 'intimacy.rhythm', '写这场戏的节律（几段、每段谁占上风）');
      if (!arr(im.tells).length) add('BLOCK', 'intimacy.tells', '写她身体先于嘴的信号至少一条');
      if (!filled(im.negotiation)) add('WARN', 'intimacy.negotiation', '开场条件空着：她肯开始前要先确认什么');
      if (!arr(im.sensitive).length) add('WARN', 'intimacy.sensitive', '敏感点空着');
      if (!arr(im.limits).length) add('WARN', 'intimacy.limits', '死线空着：写了死线，越界才有重量');
      if (!filled(im.first_exp)) add('WARN', 'intimacy.first_exp', '第一次的设定空着');
      if (!filled(im.body)) add('WARN', 'intimacy.body', '身体细节空着：写三处会被反复写到的');
      if (!arr(im.scenes).length) add('WARN', 'intimacy.scenes', '场景骨架空着：至少两场，写清进到哪一步收');
      if (arr(im.rhythm).length && arr(im.rhythm).length < 3) add('WARN', 'intimacy.rhythm', '少于三段：两段写不出转折');
    } else if (nsfw && d.role !== 'foil') {
      add('WARN', 'nsfw', '成人向书里这张卡没标 nsfw：不涉性就忽略；有床戏就标 true 并把 intimacy 填满');
    }

    // ── 模板残留 ──
    const raw = JSON.stringify(d);
    for (const ph of PLACEHOLDERS) {
      if (raw.includes(ph)) add('BLOCK', 'template', `模板占位符没删：「${ph.slice(0, 16)}」`);
    }

    // ── 同书冲突 ──
    if (filled(d.function) && fnCount.get(d.function) > 2) {
      add('WARN', 'function', `功能位「${d.function}」已有 ${fnCount.get(d.function)} 人（同卷 ≤2）`);
    }
    if (filled(d.memory_hook) && hooks.get(text(d.memory_hook)) > 1) {
      add('WARN', 'memory_hook', '与他人的记忆点重复');
    }
  }

  // ── 同声：两个人的卡上台词长短贴得太近，正文大概率也分不开 ──
  for (let i = 0; i < voices.length; i += 1) {
    for (let j = i + 1; j < voices.length; j += 1) {
      const a = voices[i];
      const b = voices[j];
      if (Math.abs(a.avg - b.avg) < 1.5 && Math.abs(a.short - b.short) < 0.15) {
        rows.push({
          level: 'WARN', file: '(全书声线)', field: 'same-voice',
          msg: `${a.name} 与 ${b.name}：平均句长 ${a.avg.toFixed(1)} / ${b.avg.toFixed(1)} 字，短句率 ${(a.short * 100).toFixed(0)}% / ${(b.short * 100).toFixed(0)}% —— 声音贴太近，让一个说完整句、一个说碎话`,
        });
      }
    }
  }

  const blocks = rows.filter((r) => r.level === 'BLOCK');
  const warns = rows.filter((r) => r.level === 'WARN');

  if (a.json) {
    console.log(JSON.stringify({ cards: cards.length, blocking: blocks.length, warnings: warns.length, rows }, null, 2));
  } else {
    let cur = '';
    for (const r of rows) {
      if (r.file !== cur) { cur = r.file; console.log(`\n${cur}`); }
      console.log(`  ${r.level === 'BLOCK' ? '✗' : '!'} ${r.field}：${r.msg}`);
    }
    console.log(`\n${cards.length} 张卡 · blocking ${blocks.length} · warn ${warns.length}`);
    if (blocks.length) console.log('blocking 不修完不许写这一章（结构不全的卡，写手只能自己编）。');
  }
  process.exit(blocks.length ? 1 : 0);
}

main();
