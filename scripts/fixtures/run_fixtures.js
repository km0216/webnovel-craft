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

const ctPath = path.join(book, 'plan', 'ch', 'ch001.contract.json');
const ctBackup = fs.readFileSync(ctPath, 'utf8');
const ctObj = JSON.parse(ctBackup);
ctObj.pov = 'nobody_card';
fs.writeFileSync(ctPath, JSON.stringify(ctObj, null, 2), 'utf8');
r = node('continuity_check.js', ['--book', book, '--ch', '1'], book);
check('视角人物没卡被提醒', r.out.includes('pov-no-card'), '');
fs.writeFileSync(ctPath, ctBackup, 'utf8');

// ── 对白门 ────────────────────────────────────────────────────
console.log('对白');
r = node('dialogue_check.js', ['--book', book, '--ch', '1'], book);
check('样例章对白结构通过', r.code === 0 && !r.out.includes('flat-dialogue'), r.out.trim().split('\n')[0]);

const badDlg = path.join(book, 'chapters', 'ch011.md');
fs.writeFileSync(badDlg, [
  '第 11 章 测试', '',
  '「我想了很久，觉得我们之间的问题并不是一天两天形成的，需要认真谈一谈。」',
  '「你说得对，我也一直在考虑这件事情，只是不知道应该从什么地方开始说起。」',
  '「那我们今天就从头开始，把每一件事情都摊开来讲清楚，不要再回避了。」',
  '「好，那我先说我这边的情况，你听完以后不要急着反驳，等我说完再讲。」',
  '「可以，我答应你，今天不管说到什么程度，我都不会中途打断你的话。」',
  '「谢谢你愿意这样认真地对待我们之间的问题，我真的很感激。」',
  '「我知道你心里有气，我也一样，但是我们总要把话说完，不能一直这样僵着。」',
  '「那就开始吧。」他淡淡地说。', '',
].join('\n'), 'utf8');
r = node('dialogue_check.js', ['--book', book, '--ch', '11'], book);
check('人人完整句报 flat-dialogue', r.out.includes('flat-dialogue'), '');
check('情绪标记动词被报', r.out.includes('adverb-attribution'), '');
check('没有磕碰被报 no-stumble', r.out.includes('no-stumble'), '');
check('没有推挡被报 no-sparring', r.out.includes('no-sparring'), '');

fs.writeFileSync(badDlg, [
  '第 11 章 测试', '',
  '「你心跳很快。」', '「没有。」', '「七点吃饭吗。」', '「吃。」', '',
].join('\n'), 'utf8');
r = node('dialogue_check.js', ['--book', book, '--ch', '11'], book);
check('俗套对白被报 cliche-dialogue', r.out.includes('cliche-dialogue'), '');
fs.rmSync(badDlg, { force: true });

const dlgSrc = path.join(book, 'chapters', 'ch012.md');
const dlgOut = path.join(book, 'tmp-dialogue.txt');
fs.writeFileSync(dlgSrc, ['第 12 章 测试', '', '「你来了。」他说。', '「嗯。」', '「吃了吗。」她把碗放下。', ''].join('\n'), 'utf8');
r = node('blind_test.js', ['--file', dlgSrc, '--out', dlgOut], book);
const packed = fs.existsSync(dlgOut) ? fs.readFileSync(dlgOut, 'utf8').trim().split('\n') : [];
check('盲测包只出台词（去掉叙述与人名）', r.code === 0 && packed.length === 3 && packed.every((l) => !l.includes('他说') && !l.includes('她把')), r.out.trim());
fs.rmSync(dlgSrc, { force: true });
fs.rmSync(dlgOut, { force: true });

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

// 模糊指代：叙述里「那里/下面」代指性器官 → 报；对白里的代称豁免（是人物写法）
bj.nsfw.enabled = true;
fs.writeFileSync(path.join(nb, 'book.json'), JSON.stringify(bj, null, 2), 'utf8');
fs.writeFileSync(ch10, [
  '第 10 章 测试', '',
  '他把手放到那里，那里已经湿了。她的腿绷直，脚趾蜷起来。',
  '「别碰那里。」她咬着牙说。', '',
].join('\n'), 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('叙述用代称报 vague-anatomy', r.out.includes('vague-anatomy'), r.out.trim().split('\n').slice(-2)[0] || '');
check('对白里的代称豁免', (r.out.match(/vague-anatomy/g) || []).length === 1, '');
check('整章字数不够 L4 规格报 under-length', r.out.includes('under-length'), '');

// 换词凑数：同一部位一章里叫出三种以上 → 报
fs.writeFileSync(ch10, [
  '第 10 章 测试', '',
  '她的穴口绞紧，肉穴里一片湿。他退出来，又顶进小穴。', '',
].join('\n'), 'utf8');
r = node('nsfw_check.js', ['--book', nb, '--ch', '10'], nb);
check('同部位换三种叫法报 term-rotation', r.out.includes('term-rotation'), '');
fs.writeFileSync(ch10, plainText, 'utf8');
fs.writeFileSync(ch10, plainText, 'utf8');

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

// ── 角色卡门 ──────────────────────────────────────────────────
console.log('角色卡');
const cb = freshCopy();
r = node('char_check.js', ['--book', cb], cb);
check('完整卡放行', r.code === 0, r.out.trim().split('\n').slice(-1)[0]);

const goodCard = path.join(SKILL, 'examples', 'cards', 'gan_tang.json');
fs.copyFileSync(goodCard, path.join(cb, 'canon', 'characters', 'gan_tang.json'));
const cbBook = JSON.parse(fs.readFileSync(path.join(cb, 'book.json'), 'utf8'));
cbBook.nsfw = { enabled: true, explicit_level: 'L4', profile: 'white-text' };
fs.writeFileSync(path.join(cb, 'book.json'), JSON.stringify(cbBook, null, 2), 'utf8');
r = node('char_check.js', ['--book', cb], cb);
check('成人向书里 18 岁卡放行', r.code === 0, r.out.trim().split('\n').slice(-1)[0]);

const cardPath = path.join(cb, 'canon', 'characters', 'gan_tang.json');
const cardObj = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
cardObj.age = 16;
fs.writeFileSync(cardPath, JSON.stringify(cardObj, null, 2), 'utf8');
r = node('char_check.js', ['--book', cb, '--id', 'gan_tang'], cb);
check('成人向书里未成年卡必须拒绝', r.code === 1 && r.out.includes('年龄 16'), r.out.trim().split('\n')[2] || r.out.trim());

delete cardObj.stable.surface_want;
cardObj.age = 18;
fs.writeFileSync(cardPath, JSON.stringify(cardObj, null, 2), 'utf8');
r = node('char_check.js', ['--book', cb, '--id', 'gan_tang'], cb);
check('缺 surface_want 必须拒绝', r.code === 1 && r.out.includes('surface_want'), '');

cardObj.stable.surface_want = cardObj.stable.deep_need;
fs.writeFileSync(cardPath, JSON.stringify(cardObj, null, 2), 'utf8');
r = node('char_check.js', ['--book', cb, '--id', 'gan_tang'], cb);
check('surface_want 与 deep_need 同句必须拒绝', r.code === 1 && r.out.includes('必须错开'), '');

r = node('new_char.js', ['--book', cb, '--id', 'lin_wan', '--name', '林晚', '--role', 'supporting', '--function', '施压者', '--age', '27'], cb);
check('new_char 建卡成功', r.code === 0 && fs.existsSync(path.join(cb, 'canon', 'characters', 'lin_wan.json')), r.out.trim().split('\n')[0]);
r = node('char_check.js', ['--book', cb, '--id', 'lin_wan'], cb);
check('模板未填被拦住', r.code === 1 && r.out.includes('模板占位符'), '');

// 同声：两个人的台词改成一样 → 报 same-voice
const svBook = freshCopy();
const svA = JSON.parse(fs.readFileSync(path.join(svBook, 'canon', 'characters', 'sunian.json'), 'utf8'));
const svBPath = path.join(svBook, 'canon', 'characters', 'suye.json');
const svB = JSON.parse(fs.readFileSync(svBPath, 'utf8'));
svB.stable.lines = svA.stable.lines;
svB.stable.speech.sparring = svA.stable.speech.sparring;
fs.writeFileSync(svBPath, JSON.stringify(svB, null, 2), 'utf8');
r = node('char_check.js', ['--book', svBook], svBook);
check('两人说话一个腔报 same-voice', r.out.includes('same-voice'), '');

// 情欲卡：成人向书没填节律 → 拦cardObj.stable.surface_want = '让他先开口，她好显得不在乎。';
delete cardObj.intimacy.rhythm;
fs.writeFileSync(cardPath, JSON.stringify(cardObj, null, 2), 'utf8');
r = node('char_check.js', ['--book', cb, '--id', 'gan_tang'], cb);
check('成人向卡缺情欲节律必须拒绝', r.code === 1 && r.out.includes('intimacy.rhythm'), r.out.trim().split('\n').slice(-2)[0] || '');

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
