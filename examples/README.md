# demo-book · 能跑的最小样例

三章、两角色、一条伏笔。用来验证链路，也是**建新书时照抄的结构**。

```
book.json                 书配置（平台/篇幅/禁区/阈值/NSFW）
canon/facts.jsonl         4 条事实，其中 F1 已被 F4 取代（演示「只失效不删」）
canon/characters/         苏念（主角）、苏野
ledger/foreshadow.jsonl   X1：门槛下那封信（第 3–5 章窗口）
ledger/chapter-log.jsonl  三章速记（rebuild 的「近章速记」来源）
plan/ch/                  三份合同（第 3 章后留了「她没敢问哥哥」的承诺）
chapters/                 三章正文
deltas/                   三份 delta（settle 的输入）
reports/ch001.review.json 一份合规的软审报告（check_report 的参照）
state/                    context.md + knowledge.json（派生，可删可重建）
.craft/                   结算日志与备份（可删）
```

## 从头跑一遍

```bash
S=scripts
B=examples/demo-book

node $S/rebuild.js          --book $B --ch 1        # 写前：拿上下文
node $S/output_check.js     --book $B --ch 1        # 机械门
node $S/continuity_check.js --book $B --ch 1        # 硬层
node $S/check_report.js     --book $B --ch 1 --report $B/reports/ch001.review.json
node $S/settle.js           --book $B --ch 1 --delta $B/deltas/ch001.json
node $S/rebuild.js          --book $B --ch 2        # 为下一章准备
```

三章都已结算过，所以 `settle` 会显示「已结算过，跳过」——这就是幂等。

## 想看它拦住东西

```bash
# 伏笔逾期：X1 窗口到第 5 章，问第 9 章 → blocking
node $S/continuity_check.js --book $B --ch 9

# 改既定事实但不声明 supersedes → 拒绝
node $S/settle.js --book $B --ch 4 --delta scripts/fixtures/negative/delta-conflict.json

# 伏笔从 setup 直接 payoff → 拒绝
node $S/settle.js --book $B --ch 4 --delta scripts/fixtures/negative/delta-foreshadow-jump.json
```

## 建自己的书

```bash
node scripts/new_book.js --dir <新书目录> --title "书名" --genre "玄幻" --platform "番茄"
```

按它打印的四步填：`sacred` + `whitelist` → 主角卡 → 第 1 章合同 → `rebuild`。

不想用脚本就复制 demo-book，删掉 `chapters/ deltas/ state/ .craft/` 和账本里的内容。
