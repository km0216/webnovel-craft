'use strict';

const fs = require('fs');
const path = require('path');

// Book-local only: never inherit an unrelated workspace or another book's choices.
// 白名单有两个来源，合起来用：
//   1) <book>/.deslop-whitelist   一行一词，# 注释（书目录里手写的豁免）
//   2) <book>/book.json 的 whitelist 数组（跟书一起进版本库，专名/术语/反派绰号）
function bookRootOf(file) {
  const parent = path.dirname(path.resolve(file));
  const name = path.basename(parent);
  if (name === '正文' || name === 'chapters') return path.dirname(parent);
  return parent;
}

function readDeslopWhitelist(book) {
  try {
    return fs.readFileSync(path.join(book, '.deslop-whitelist'), 'utf8')
      .split(/\r?\n/).map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function readBookWhitelist(book) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(book, 'book.json'), 'utf8'));
    return Array.isArray(raw.whitelist) ? raw.whitelist.filter((x) => typeof x === 'string' && x.trim()) : [];
  } catch (error) {
    return [];
  }
}

function loadStyleWhitelist(file) {
  const book = bookRootOf(file);
  return Array.from(new Set(readDeslopWhitelist(book).concat(readBookWhitelist(book))))
    .sort((a, b) => b.length - a.length);
}

function styleSpans(text, whitelist) {
  const spans = [];
  for (const literal of whitelist) {
    for (let at = text.indexOf(literal); at !== -1; at = text.indexOf(literal, at + 1)) {
      spans.push([at, at + literal.length]);
    }
  }
  return spans;
}

function maskStyleText(text, whitelist) {
  const chars = text.split('');
  for (const [start, end] of styleSpans(text, whitelist)) {
    chars.fill('？', start, end);
  }
  return chars.join('');
}

module.exports = { loadStyleWhitelist, styleSpans, maskStyleText, bookRootOf };
