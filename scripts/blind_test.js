#!/usr/bin/env node
'use strict';
// blind_test.js —— 把一章拆成「只有台词」的盲测包：去掉叙述与说话人，供人/别的模型打分。
// 用法：
//   node blind_test.js --book <书> --ch 12 --out <文件>
//   node blind_test.js --file <章节文件> --out <文件> [--numbered]
// 退出码：0 成功 / 2 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node blind_test.js --book DIR --ch N | --file PATH --out FILE [--numbered]';

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  let file = a.file;
  if (!file) {
    if (!a.book || !a.ch) C.die(USAGE, 2);
    file = C.bookPaths(path.resolve(a.book)).chapter(Number(a.ch));
  }
  if (!fs.existsSync(file)) C.die(`找不到正文：${file}`, 2);

  const text = fs.readFileSync(file, 'utf8');
  const lines = [];
  for (const m of text.matchAll(/[「“]([^」”]{1,400})[」”]/g)) {
    const s = m[1].trim();
    if (s) lines.push(s);
  }
  if (!lines.length) C.die('这一章没有引号对白，没什么可测的', 2);

  const body = a.numbered
    ? lines.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : lines.join('\n');
  const out = a.out || path.join(path.dirname(file), `${path.basename(file, '.md')}.dialogue.txt`);
  C.writeTextAtomic(path.resolve(out), `${body}\n`);
  console.log(`${lines.length} 句台词 → ${out}`);
  console.log('盲测怎么问、怎么看结果：references/13-dialogue.md §11');
}

main();
