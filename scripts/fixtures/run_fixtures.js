#!/usr/bin/env node
'use strict';
// run_fixtures.js —— 改任何规则/脚本后必跑。负样本必须按预期失败，正样本必须通过。
// 用法：node scripts/fixtures/run_fixtures.js
// 退出码：0 全过；1 有失败

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(SKILL, 'scripts');
const DEMO = path.join(SKILL, 'examples', 'demo-book');
const FIX = __dirname;

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); } else { fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function node(script, args, cwd) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// 复制一份干净的书：账本清空，派生删掉
function freshCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnc-fixture-'));
  const book = path.join(dir, 'book');
  fs.cpSync(DEMO, book, { recursive: true });
  for (const p of [path.join(book, '.craft'), path.join(book, 'state')]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  for (const p of [
    path.join(book, 'canon', 'facts.jsonl'),
    path.join(book, 'ledger', 'foreshadow.jsonl'),
    path.join(book, 'ledger', 'chapter-log.jsonl'),
  ]) fs.writeFileSync(p, '', 'utf8');
  return book;
}

console.log('账本层 fixtures');
const book = freshCopy();
const D = (n) => path.join(book, 'deltas', `ch00${n}.json`);
const N = (f) => path.join(FIX, 'negative', f);

let r = node('settle.js', ['--book', book, '--ch', '1', '--delta', D(1)], book);
check('ch1 正常结算', r.code === 0, r.out.trim().split('\n')[0]);

r = node('settle.js', ['--book', book, '--ch', '1', '--delta', D(1)], book);
check('幂等：同一 delta 重提不重复写', r.code === 0 && r.out.includes('已结算过'), r.out.trim());

r = node('settle.js', ['--book', book, '--ch', '2', '--delta', D(1)], book);
check('chapter 不符必须拒绝', r.code === 1 && r.out.includes('不一致'), r.out.trim());

r = node('settle.js', ['--book', book, '--ch', '2', '--delta', D(2)], book);
check('ch2 正常结算（伏笔状态机前进）', r.code === 0, r.out.trim().split('\n')[0]);

r = node('settle.js', ['--book', book, '--ch', '3', '--delta', D(3)], book);
check('ch3 supersedes：旧事实盖终点不删', r.code === 0 && r.out.includes('失效不删 1 条'), r.out.trim().split('\n')[0]);

const facts = fs.readFileSync(path.join(book, 'canon', 'facts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
check('F1 仍在文件里（只失效不删）', facts.some((f) => f.id === 'F1' && f.valid_until_ch === 2));
check('F4 生效', facts.some((f) => f.id === 'F4' && f.valid_until_ch === null));

r = node('settle.js', ['--book', book, '--ch', '4', '--delta', N('delta-conflict.json')], book);
check('未声明 supersedes 的改值必须拒绝', r.code === 1 && r.out.includes('冲突'), r.out.trim().split('\n').slice(0, 2).join(' '));

r = node('settle.js', ['--book', book, '--ch', '4', '--delta', N('delta-foreshadow-jump.json')], book);
check('伏笔跳步必须拒绝', r.code === 1 && r.out.includes('不能执行 payoff'), r.out.trim().split('\n').slice(0, 2).join(' '));

r = node('rebuild.js', ['--book', book, '--ch', '4'], book);
check('rebuild 正常', r.code === 0);
const ctx = fs.readFileSync(path.join(book, 'state', 'context.md'), 'utf8');
check('上下文含七栏', ['## 1. 当前位置', '## 4. 活跃伏笔', '## 7. 连贯性风险'].every((s) => ctx.includes(s)));
check('已失效事实不进上下文', !ctx.includes('F1｜'));
check('复活事实进了上下文', ctx.includes('F4｜'));
check('上下文不超 8 KB', Buffer.byteLength(ctx, 'utf8') <= 8 * 1024);

r = node('rebuild.js', ['--book', book, '--ch', '4', '--max-kb', '0'], book);
check('预算为 0 时降级不崩', r.code === 0);

const know = JSON.parse(fs.readFileSync(path.join(book, 'state', 'knowledge.json'), 'utf8'));
check('三视角：reader_known 只含已展示的', Array.isArray(know.reader_known) && know.reader_known.length === 3);
check('三视角：角色 known 带章号', know.characters.sunian.known.length >= 3);

// ── 机械门 ────────────────────────────────────────────────────
console.log('机械门');
r = node('output_check.js', ['--book', book, '--ch', '1'], book);
check('干净章放行（无 blocking）', r.code === 0, r.out.trim().split('\n')[0]);

fs.writeFileSync(path.join(book, 'chapters', 'ch009.md'), [
  '第 9 章 测试', '', '以下是本章内容。作为一个 AI，我会尽力写好这一段。',
  '苏念站在门口，钥匙在锁孔里转了两圈，没动。【待补细节】', 'TODO: 这里补一段对话。', '',
].join('\n'), 'utf8');
r = node('output_check.js', ['--book', book, '--ch', '9'], book);
check('拦住指令泄漏', r.code === 1 && r.out.includes('instruction-leak'), r.out.trim().split('\n').slice(0, 2).join(' '));
check('拦住占位符', r.out.includes('placeholder'), '');
fs.rmSync(path.join(book, 'chapters', 'ch009.md'), { force: true });

// ── 连贯性 ────────────────────────────────────────────────────
console.log('连贯性');
r = node('continuity_check.js', ['--book', book, '--ch', '4'], book);
check('未逾期时无 blocking', r.code === 0, r.out.trim().split('\n').slice(0, 3).join(' '));
r = node('continuity_check.js', ['--book', book, '--ch', '9'], book);
check('伏笔逾期 3 章以上升 blocking', r.code === 1 && r.out.includes('fore-overdue'), r.out.trim().split('\n').filter((l) => l.includes('fore-overdue')).join(' '));

// ── NSFW 语域（用词按实际情况判：同一句在不同 profile 下评价不同）──
console.log('NSFW 语域');
const nb = freshCopy();
const bj = JSON.parse(fs.readFileSync(path.join(nb, 'book.json'), 'utf8'));
bj.nsfw = { enabled: true, explicit_level: 'L4', profile: 'white-text' };
fs.writeFileSync(path.join(nb, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
const ch10 = path.join(nb, 'chapters', 'ch010.md');
const plainText = [
  '第 10 章 测试', '',
  '他把她抵在门上，乳肉贴着衬衫。她的内壁绞紧，蜜液顺着腿根淌下来。',
  '「别。」她咬住嘴唇。', '他低头，吻她的花蒂。她打颤，脚趾蜷起来。', '后来她缓过来，抱着他不动。', '',
].join('\n');
fs.writeFileSync(ch10, plainText, 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('白文全 plain 不报', r.code === 0 && !r.out.includes('register-mismatch'), r.out.trim().split('\n').slice(-1)[0]);

fs.writeFileSync(ch10, plainText.replace('内壁', '幽谷').replace('蜜液', '淫水').replace('后来她缓过来，抱着他不动。', ''), 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('文雅词在白文里报域不匹配', r.out.includes('register-mismatch') && r.out.includes('幽谷'), '');
check('同段混两段域报 mixed', r.out.includes('register-mixed'), '');

bj.nsfw.explicit_level = 'L3';
fs.writeFileSync(path.join(nb, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('用词强度超过声明等级', r.out.includes('level-exceeded'), '');

bj.nsfw.profile = 'literary';
bj.nsfw.explicit_level = 'L5';
fs.writeFileSync(path.join(nb, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
fs.writeFileSync(ch10, plainText, 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('同一句换 literary profile 后 plain 词被接受', !r.out.includes('register-mismatch'), r.out.trim().split('\n').slice(-1)[0]);

bj.nsfw.enabled = false;
fs.writeFileSync(path.join(nb, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('未启用时直接跳过', r.code === 0 && r.out.includes('未启用'), '');

// ── 软审报告校验（reviewer 是 LLM，这层是它的护栏）──────────────
console.log('软审报告');
const repFile = path.join(book, 'reports', 'ch001.review.json');
r = node('check_report.js', ['--book', book, '--ch', '1', '--report', repFile], book);
check('合规报告通过', r.code === 0, r.out.trim().split('\n')[0]);

const badRep = JSON.parse(fs.readFileSync(repFile, 'utf8'));
badRep.verdict = 'pass';
badRep.issues = [{
  severity: 'blocking', category: 'prose_ai',
  evidence: '这里是一句正文里根本没有的话', why: '测试', fix_hint: '测试', blocking: true,
}];
const badFile = path.join(book, 'reports', 'ch001.bad.json');
fs.writeFileSync(badFile, JSON.stringify(badRep, null, 2), 'utf8');
r = node('check_report.js', ['--book', book, '--ch', '1', '--report', badFile], book);
check('编造证据被拒', r.code === 1 && r.out.includes('搜不到'), r.out.trim().split('\n').slice(1, 2).join(' '));
check('有 blocking 却给 pass 被拒', r.out.includes('却给 pass'), '');

// ── 建书脚手架 ────────────────────────────────────────────────
console.log('建书');
const scaffold = path.join(path.dirname(book), 'scaffold');
r = node('new_book.js', ['--dir', scaffold, '--title', '测试书', '--platform', '番茄'], path.dirname(scaffold));
check('建书成功', r.code === 0 && fs.existsSync(path.join(scaffold, 'book.json')), r.out.trim().split('\n')[0]);
const sb = JSON.parse(fs.readFileSync(path.join(scaffold, 'book.json'), 'utf8'));
check('平台预置生效（番茄 2000–3000）', sb.word_window[0] === 2000 && sb.word_window[1] === 3000, JSON.stringify(sb.word_window));
r = node('rebuild.js', ['--book', scaffold, '--ch', '1'], scaffold);
check('建完直接能 rebuild', r.code === 0, r.out.trim().split('\n')[0]);
r = node('new_book.js', ['--dir', scaffold], path.dirname(scaffold));
check('重复建书不覆盖', r.code === 0 && r.out.includes('已经有书了'), r.out.trim());

// 批 2 才有的检测器：存在才跑
const detector = path.join(SCRIPTS, 'check_ai_patterns.js');
if (fs.existsSync(detector)) {
  const clean = fs.readdirSync(path.join(FIX, 'negative_clean')).map((f) => path.join(FIX, 'negative_clean', f));
  const res = spawnSync(process.execPath, [detector, '--check', '--json', ...clean], { encoding: 'utf8' });
  let blocking = 0;
  try { blocking = (JSON.parse(res.stdout).findings || []).filter((x) => x.severity === 'blocking').length; } catch (e) { blocking = -1; }
  check('人类正常稿 blocking = 0', blocking === 0, `blocking=${blocking}`);
} else {
  console.log('  SKIP 检测器未上线（批 2）');
}

fs.rmSync(path.dirname(book), { recursive: true, force: true });

console.log(`\n${pass} 通过 · ${fails.length} 失败`);
if (fails.length) { console.log(`失败项：${fails.join(' / ')}`); process.exit(1); }
