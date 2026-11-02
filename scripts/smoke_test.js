#!/usr/bin/env node
'use strict';
// smoke_test.js —— 端到端冒烟：建书 → 建卡 → 卡门 → 写章 → 三道门 → 盲测出包/汇总。
// 用法：node smoke_test.js
// 退出码：0 全过 / 1 有失败

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..');
const S = path.join(SKILL, 'scripts');
const TPL_CARD = path.join(SKILL, 'examples', 'cards', 'gan_tang.json');

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS ${name}`); } else { fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function node(script, args, cwd) {
  const r = spawnSync(process.execPath, [path.join(S, script), ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnc-smoke-'));
const book = path.join(dir, 'book');

console.log('1 建书');
let r = node('new_book.js', ['--dir', book, '--title', '冒烟', '--platform', '番茄'], dir);
check('new_book', r.code === 0 && fs.existsSync(path.join(book, 'book.json')), r.out.trim().split('\n')[0]);

console.log('2 建卡');
r = node('new_char.js', ['--book', book, '--id', 'protagonist', '--name', '测试', '--role', 'protagonist', '--age', '24', '--force'], dir);
check('new_char', r.code === 0 && fs.existsSync(path.join(book, 'canon', 'characters', 'protagonist.json')), r.out.trim().split('\n')[0]);
r = node('char_check.js', ['--book', book], book);
check('空模板被卡门拦住', r.code === 1 && r.out.includes('模板占位符'), '');

fs.copyFileSync(TPL_CARD, path.join(book, 'canon', 'characters', 'gan_tang.json'));
r = node('char_check.js', ['--book', book, '--id', 'gan_tang'], book);
check('填好的卡放行', r.code === 0, r.out.trim().split('\n').slice(-1)[0]);

console.log('3 写章 + 三道门');
// 冒烟只验链路不验篇幅：把窗口放开，否则一段样例必然被字数门拦住（那是正常行为）
const bj0 = JSON.parse(fs.readFileSync(path.join(book, 'book.json'), 'utf8'));
bj0.word_window = [20, 8000];
fs.writeFileSync(path.join(book, 'book.json'), JSON.stringify(bj0, null, 2), 'utf8');
const ctPath = path.join(book, 'plan', 'ch', 'ch001.contract.json');
const ct = JSON.parse(fs.readFileSync(ctPath, 'utf8'));
ct.word_window = [20, 8000];
ct.required_appearances = [];
fs.writeFileSync(ctPath, JSON.stringify(ct, null, 2), 'utf8');
const ch = path.join(book, 'chapters', 'ch001.md');
fs.writeFileSync(ch, [
  '第 1 章 冒烟', '',
  '「你来了。」她说。', '「嗯。」', '「吃了吗。」', '「没。」', '',
  '他把伞收起来，立在门边。她看了一眼，没说话。', '',
].join('\n'), 'utf8');
r = node('output_check.js', ['--book', book, '--ch', '1'], book);
check('output_check 无 blocking', r.code === 0, r.out.trim().split('\n')[0]);
r = node('dialogue_check.js', ['--book', book, '--ch', '1'], book);
check('dialogue_check 能跑', r.code === 0, r.out.trim().split('\n')[0]);
r = node('blind_test.js', ['--book', book, '--ch', '1', '--out', path.join(dir, 'dlg.txt')], dir);
check('blind_test 出包', r.code === 0 && fs.readFileSync(path.join(dir, 'dlg.txt'), 'utf8').includes('你来了'), r.out.trim());

console.log('4 NSFW 链');
const bj = JSON.parse(fs.readFileSync(path.join(book, 'book.json'), 'utf8'));
bj.nsfw = { enabled: true, explicit_level: 'L4', profile: 'white-text' };
fs.writeFileSync(path.join(book, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
r = node('nsfw_check.js', ['--book', book, '--ch', '1'], book);
check('nsfw_check 跑得动并报 under-length', r.code === 0 && r.out.includes('under-length'), r.out.trim().split('\n').slice(-1)[0]);

console.log('5 盲测汇总');
const rep = path.join(dir, 'blind.json');
fs.writeFileSync(rep, JSON.stringify([
  { reader: 'R1', version: 'A', realism: 4, distinct: 4 },
  { reader: 'R2', version: 'A', realism: 4, distinct: 3 },
  { reader: 'R3', version: 'B', realism: 2, distinct: 2 },
]), 'utf8');
r = node('blind_report.js', ['--in', rep, '--markdown'], dir);
check('blind_report 出表 + 判决', r.code === 0 && r.out.includes('判决') && r.out.includes('| A |'), r.out.trim().split('\n')[0]);

console.log('6 文档与脚本对齐');
const skillMd = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
const cmds = [...skillMd.matchAll(/node scripts\/([a-z_]+)\.js/g)].map((m) => m[1]);
const missing = [...new Set(cmds)].filter((c) => !fs.existsSync(path.join(S, `${c}.js`)));
check('SKILL 里提到的脚本都存在', missing.length === 0, missing.join(','));
const refs = [...skillMd.matchAll(/`(\d\d-[a-z-]+\.md)`/g)].map((m) => m[1]);
const missRef = [...new Set(refs)].filter((f) => !fs.existsSync(path.join(SKILL, 'references', f)));
check('SKILL 里提到的 references 都存在', missRef.length === 0, missRef.join(','));

console.log('7 人类稿回归');
const human = fs.readdirSync(path.join(S, 'fixtures', 'negative_clean')).map((f) => path.join(S, 'fixtures', 'negative_clean', f));
const noisy = human.filter((f) => {
  const o = node('dialogue_check.js', ['--file', f, '--json'], dir);
  try { return (JSON.parse(o.out).issues || []).length > 0; } catch (e) { return true; }
});
check('人类稿对白门零误报', noisy.length === 0, noisy.map((f) => path.basename(f)).join(','));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} 通过 · ${fails.length} 失败`);
if (fails.length) { console.log(`失败项：${fails.join(' / ')}`); process.exit(1); }
