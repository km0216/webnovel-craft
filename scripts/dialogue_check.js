#!/usr/bin/env node
'use strict';
// dialogue_check.js —— 对白的结构门：占比 / 句长 / 标记动词 / 独白 / 有没有磕碰。
// 判不了好不好，只堵「人人说完整漂亮句」这一类机械毛病。方法见 references/13-dialogue.md
//
// 用法：
//   node dialogue_check.js --book <书> --ch 12 [--json] [--strict]
//   node dialogue_check.js --file <章节文件> [--json] [--strict]
// 退出码：0 无 blocking（默认全是 advisory）；1 = --strict 且有提示；2 = 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node dialogue_check.js --book DIR --ch N | --file PATH [--json] [--strict]';

const QUOTED = /[「“"]([^」”"\n]{1,400})[」”"]/g;
const ADVERB_ATTR = /(?:冷笑|苦笑|嘲笑|不屑|冷冷|淡淡|轻轻|轻轻|低声|轻声|沉声|哑声|柔声|厉声|温柔|愤怒|恼火)[地]?(?:说|道|问|答|喊|叫|吼)|\b\w{1,3}(?:笑道|怒道|冷道|低声道|轻声道|沉声道|哑声道)/g;
const STUMBLE_MARKS = /(?:没说完|未说完|话到一半|半句|咽回去|咽了下去|打断|接了过去|抢过话|顿了一下|顿了顿)/g;
const MIN_SHORT = 6;
// 阈值按 negative_clean 里 10 篇人类稿校准：占比 27.7–41.1% · 平均 5.6–8.4 字 · 短句 52–71%
// 取「明显低于人类」的位置当噪声底：句长 12、短句 35%、占比 15%（约人类下限的一半），不拿中位数当及格线
const AVG_MAX = 12;
const SHORT_RATIO_MIN = 0.35;
const INFO_DUMP_MIN = 60;
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.6;

function plainLen(s) {
  return Array.from(s.replace(/\s+/g, '')).length;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  let file = a.file;
  let label = a.file;
  if (!file) {
    if (!a.book || !a.ch) C.die(USAGE, 2);
    const P = C.bookPaths(path.resolve(a.book));
    file = P.chapter(Number(a.ch));
    label = `第 ${a.ch} 章`;
  }
  if (!fs.existsSync(file)) C.die(`找不到正文：${file}`, 2);
  const text = fs.readFileSync(file, 'utf8');

  const utterances = [];
  for (const m of text.matchAll(QUOTED)) {
    const body = m[1];
    utterances.push({ body, len: plainLen(body), at: m.index });
  }

  const total = plainLen(text.replace(/第[^\n]{0,20}章[^\n]*\n/, ''));
  const dialogueChars = utterances.reduce((n, u) => n + u.len, 0);
  const ratio = total ? dialogueChars / total : 0;
  const avg = utterances.length ? dialogueChars / utterances.length : 0;
  const shorts = utterances.filter((u) => u.len <= MIN_SHORT).length;
  const shortRatio = utterances.length ? shorts / utterances.length : 0;

  const issues = [];
  const add = (rule, message, evidence) => issues.push({ severity: 'advisory', rule, message, evidence: evidence || '' });

  if (utterances.length >= 6) {
    if (ratio < RATIO_MIN) {
      add('dialogue-ratio', `对白只占 ${(ratio * 100).toFixed(0)}%：场景成了叙述报告。要么补对白，要么把过场写成转述后把戏交给对话`, '');
    } else if (ratio > RATIO_MAX) {
      add('dialogue-ratio', `对白占 ${(ratio * 100).toFixed(0)}%：整章在说，没有身体、没有场景。加动作和停顿`, '');
    }
  }

  if (avg > AVG_MAX && shortRatio < SHORT_RATIO_MIN) {
    add('flat-dialogue', `对白平均 ${avg.toFixed(1)} 字，6 字以内的短句只占 ${(shortRatio * 100).toFixed(0)}%：人人都在说完整句，读着像轮流念稿。打碎，加半句、加打断`, '');
  }

  const adverbHits = Array.from(text.matchAll(ADVERB_ATTR));
  if (adverbHits.length) {
    add('adverb-attribution', `标记动词带情绪 ${adverbHits.length} 处（${adverbHits.slice(0, 3).map((m) => m[0]).join(' / ')}）：改回「说」，情绪交给台词和一个动作`, adverbHits[0][0]);
  }

  const dumps = utterances.filter((u) => u.len > INFO_DUMP_MIN);
  if (dumps.length) {
    add('info-dump-line', `${dumps.length} 句对白超过 ${INFO_DUMP_MIN} 字：拆开，或者让人打断他`, dumps[0].body.slice(0, 24));
  }

  // 磕碰只算叙述里的（对白里说「打断」不算磕碰）
  const narration = text.replace(/[「“][^」”]*[」”]/g, '');
  let stumbles = (narration.match(STUMBLE_MARKS) || []).length;
  for (let i = 1; i < utterances.length; i++) {
    if (utterances[i].len <= 5 && utterances[i - 1].len >= 12) stumbles += 1;
  }
  if (utterances.length >= 8 && stumbles === 0) {
    add('no-stumble', '整章没有一处打断、答非所问或短接：太顺了，像把每句都想好了才说。至少加两处磕碰', '');
  }

  // 废句：没有一句没功能的话，其余台词就全成了台词卡
  const FILLER_WORDS = /(几点|冷不冷|热不热|饭|吃|饿|困|睡着|睡|下雨|雨|空调|灯|喝水|水|抽根|烟|酒|堵车|地铁|明早|回家|上班|下班|累|钥匙|手机|电话|衣服)/;
  const hasFiller = utterances.some((u) => u.len <= 15 && FILLER_WORDS.test(u.body));
  if (utterances.length >= 8 && !hasFiller) {
    add('no-filler-line', '整章没有一句废句（几点了 / 冷不冷 / 吃没吃）：缺了这种话，别的台词就没有落差，全像台词卡', '');
  }

  // 推挡：有没有短回应顶回去（不接 / 顶回来 / 改一个字）
  const PUSH_BACK = /[不没就才也偏敢别]/;
  let sparring = 0;
  for (let i = 1; i < utterances.length; i++) {
    if (utterances[i].len <= 8 && PUSH_BACK.test(utterances[i].body)) sparring += 1;
  }
  if (utterances.length >= 8 && sparring < 2) {
    add('no-sparring', `只有 ${sparring} 处短回应顶回去：读起来像一人一句独白接力。让人不接、顶回来、或把上句改掉一个字`, '');
  }

  // 对白俗套（情欲场景里最摆拍的那几句；「别问/你敢/别看」人类的稿子里本来就有，不收）
  const CLICHE_DIALOGUE = ['你心跳很快', '你怕我', '叫我的名字'];
  for (const c of CLICHE_DIALOGUE) {
    if (utterances.some((u) => u.body.includes(c))) {
      add('cliche-dialogue', `「${c}」是熟到发旧的台词：能用一个动作替代就不写台词（13-dialogue.md §4.6）`, c);
    }
  }

  if (a.json) {
    console.log(JSON.stringify({
      file, utterances: utterances.length, dialogue_ratio: Number(ratio.toFixed(3)),
      avg_len: Number(avg.toFixed(1)), short_ratio: Number(shortRatio.toFixed(2)),
      stumbles, issues,
    }, null, 2));
  } else {
    console.log(`${label} 对白：${utterances.length} 句 · 占比 ${(ratio * 100).toFixed(0)}% · 平均 ${avg.toFixed(1)} 字 · 短句 ${(shortRatio * 100).toFixed(0)}% · 磕碰 ${stumbles} 处`);
    for (const i of issues) console.log(`  [${i.rule}] ${i.message}`);
    if (!issues.length) console.log('  结构上没毛病（好不好另说，见 13-dialogue.md 的三判据）。');
  }
  process.exit(a.strict && issues.length ? 1 : 0);
}

main();
