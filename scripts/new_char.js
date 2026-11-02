#!/usr/bin/env node
'use strict';
// new_char.js —— 从模板建一张角色卡（结构齐全，内容是空的；填完跑 char_check）。
// 用法：
//   node new_char.js --book <书> --id <id> --name <名字> [--role supporting] [--function 施压者] [--age 24] [--force]
// 退出码：0 建好 / 1 已存在或校验不过 / 2 用法错

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const USAGE = 'Usage: node new_char.js --book DIR --id ID --name NAME [--role protagonist|supporting|antagonist|foil] [--function 功能位] [--age N] [--force]';
const TPL = path.resolve(__dirname, '..', 'templates', 'character.json');

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  if (!a.book || !a.id || !a.name) C.die(USAGE, 2);
  const P = C.bookPaths(path.resolve(a.book));
  if (!fs.existsSync(P.book)) C.die(`不是书目录（没有 book.json）：${P.root}`, 2);

  const target = P.char(a.id);
  if (fs.existsSync(target) && !a.force) {
    console.log(`${path.relative(P.root, target)} 已经有了。要覆盖加 --force（先备份）。`);
    return;
  }

  const card = C.readJson(TPL);
  card.id = a.id;
  card.name = a.name;
  if (a.role) card.role = a.role;
  if (a.function) card.function = a.function;
  if (a.age) card.age = Number(a.age);

  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  C.writeJson(target, card);

  console.log(`建好：${path.relative(P.root, target)}`);
  console.log([
    '',
    '顺序别反：先答五问，再填字段',
    '  1. surface_want / deep_need 错开',
    '  2. fear / leverage 连人带手段一起写',
    '  3. secret 写 null 或写清谁变脸',
    '  4. behaviors 至少 3 条「触发 → 反应」，写动作不写形容词',
    '  5. lines 至少 3 条，遮住名字要认得出是谁',
    '  6. payoffs 预告 / 小兑现 / 大兑现',
    `校验：node scripts/char_check.js --book "${P.root}" --id ${a.id}`,
  ].join('\n'));
}

main();
