#!/usr/bin/env node
'use strict';
// new_book.js —— 一键建书骨架。比手动复制 demo 少踩坑。
//
// 用法：
//   node new_book.js --dir <新书目录> [--title 书名] [--genre 品类] [--platform 番茄] [--force]
// 退出码：0 = 建好（或已存在且没给 --force）；2 = 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node new_book.js --dir DIR [--title 书名] [--genre 品类] [--platform 平台] [--force]';
const TPL = path.resolve(__dirname, '..', 'templates');

const PLATFORM_PRESET = {
  番茄: { word_window: [2000, 3000], opening_hook_deadline: 300, poison_tolerance: 'medium' },
  七猫: { word_window: [2000, 3000], opening_hook_deadline: 300, poison_tolerance: 'medium' },
  起点: { word_window: [2500, 4000], opening_hook_deadline: 800, poison_tolerance: 'medium' },
  晋江: { word_window: [3000, 6000], opening_hook_deadline: 500, poison_tolerance: 'strict' },
  飞卢: { word_window: [2000, 3000], opening_hook_deadline: 300, poison_tolerance: 'strict' },
  豆瓣: { word_window: [2000, 6000], opening_hook_deadline: 0, poison_tolerance: 'loose' },
};

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.dir) C.die(USAGE, 2);
  const root = path.resolve(a.dir);
  const exists = fs.existsSync(path.join(root, 'book.json'));
  if (exists && !a.force) {
    console.log(`${root} 已经有书了，没动它。要覆盖加 --force（会先备份 book.json）。`);
    return;
  }

  const dirs = ['canon', 'canon/characters', 'ledger', 'plan', 'plan/ch', 'chapters', 'deltas', 'reports', 'state', '.craft'];
  for (const d of dirs) C.ensureDir(path.join(root, d));

  for (const f of ['canon/facts.jsonl', 'ledger/foreshadow.jsonl', 'ledger/chapter-log.jsonl']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
  }

  const book = C.readJson(path.join(TPL, 'book.json'));
  book.title = a.title || '未命名';
  book.genre = a.genre || '';
  book.platform = a.platform || '';
  const preset = PLATFORM_PRESET[book.platform];
  if (preset) Object.assign(book, preset);

  const bookFile = path.join(root, 'book.json');
  if (fs.existsSync(bookFile)) fs.copyFileSync(bookFile, `${bookFile}.bak`);
  C.writeJson(bookFile, book);

  if (!fs.existsSync(path.join(root, 'canon', 'characters', 'protagonist.json'))) {
    const c = C.readJson(path.join(TPL, 'character.json'));
    c.id = 'protagonist';
    c.name = '主角名';
    c.role = 'protagonist';
    C.writeJson(path.join(root, 'canon', 'characters', 'protagonist.json'), c);
  }
  if (!fs.existsSync(path.join(root, 'plan', 'ch', 'ch001.contract.json'))) {
    C.writeJson(path.join(root, 'plan', 'ch', 'ch001.contract.json'), C.readJson(path.join(TPL, 'chNNN.contract.json')));
  }
  if (!fs.existsSync(path.join(root, 'nsfw-lexicon.json'))) {
    console.log(`词库用默认份（要改就 cp ${path.join(TPL, 'nsfw-lexicon.json')} 到书目录）`);
  }

  console.log(`建好了：${root}`);
  console.log(preset ? `平台 ${book.platform}：字数窗口 ${book.word_window.join('–')} · 前 ${preset.opening_hook_deadline} 字要有钩子` : '没给平台，参数用默认值');
  console.log([
    '',
    '下一步：',
    `  1. 填 book.json 的 sacred（不可推翻的约束）与 whitelist（专名）`,
    `  2. 填 canon/characters/protagonist.json（四要素 + 台词样本），再照它建配角`,
    `  3. 填 plan/ch/ch001.contract.json（本章目标 / 必覆盖节点 / 禁区 / 章末钩子）`,
    `  4. node scripts/rebuild.js --book "${root}" --ch 1   → 拿到上下文再动笔`,
  ].join('\n'));
}

main();
