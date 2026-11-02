---
name: webnovel-craft
description: 写小说 / 网文（长篇连载）—— 去 AI 味 · 状态账本 · 前后连贯 · 伏笔回收 · 章节门禁 · 人设卡 · 对白与盲测。当用户要写小说 / 写网文 / 续写 / 列大纲 / 立人设 / 写人物卡 / 写细纲 / 写对白 / 审稿 / 查伏笔 / 查一致性 / 盲测，或说「太 AI 了」「像 AI」「去 AI 味」「文风不对」「对白太假」「接不上」「忘了前面写过什么」时使用。
metadata:
  version: "1.2.0"
  status: "全模块上线：账本 / 机械门 / 硬层 / 软审校验 / 三桶裁决 / 品类平台 / NSFW / 人设卡 / 对白门 / 盲测 / 冒烟"
---

# webnovel-craft · 连载工程

**人定骨架，代码守纪律，AI 只填细节。** 工程能保证的下限是：不崩设定、不丢伏笔、不错时间线、不换人格；保证不了「好看」——那靠人在大纲层定。

## 三条铁律

1. **状态在文件里，不在对话里。** 写前只读 `state/context.md` + 本章合同；写完必须跑 `settle`。只回一句「我记得」等于没做。
2. **不能让的事交给代码。** 禁区、字数窗口、伏笔到期、设定矛盾、剧透、角色不该知道的——全走脚本。写进 prompt 当「已执行」是伪约束，模型一漂就废。
3. **改稿是减法且保守。** 指不出触发标记就别动；改完跑反向门（电报体）；净改善才落地，否则回退。

## 门禁表

| 时机 | 检查 | 不通过怎么办 |
|---|---|---|
| 写正文前 | `char_check.js` 角色卡结构（五问 / 行为 / 说话方式 / 兑现表；成人向书年龄 ≥18） | blocking 就地补卡，不许拿正文补 |
| 写正文前 | `plan/ch/chNNN.contract.json` 存在吗（目标 / 必覆盖节点 / 禁区 / 章末钩子 / 下一章承诺） | 先补合同，不写正文 |
| 写正文前 | 跑 `rebuild.js` 生成本章上下文 | 没上下文不写 |
| 写完每章 | `output_check.js` 机械门（字数 / 泄漏 / 禁区 / 占位 / 退化 / AI 句式） | 有 blocking 就地改；这不叫「去 AI 味」，是没写完 |
| 写完每章 | `continuity_check.js` 硬层（14 条不变量） | blocking 改正文或补账本；advisory 人判 |
| 写完每章 | `dialogue_check.js` 对白结构（占比 / 句长 / 标记动词 / 独白 / 磕碰） | advisory 人判；整章念稿腔就重写对白 |
| 写完每章 | 软审（`06` 的 rubric，reviewer ≠ writer）→ `check_report.js` 校验报告 | 报告不合规就重跑 review；有 blocking 进改稿 |
| 定稿之后 | `settle.js` 结算（事实 / 伏笔 / 角色状态 / 认知 / 读者已知） | 冲突要么加 `supersedes`，要么不是变化 |
| 结算之后 | 再跑 `rebuild.js` 看风险栏 | 逾期伏笔、缺正文、主角缺席——当场处理 |
| 一卷收尾 / 大改后 | `blind_test.js` 出包 → 找没看过设定的人打盲测（`13-dialogue.md §11`） | realism <3 就重写对白，别靠形容词补救 |

> 三层的判决各自独立：**任何一层 blocking 都不许被另一层的好评覆盖**。改稿后重跑机械门与硬层。

## 命令

```bash
# 建新书骨架（平台参数会自动预置）
node scripts/new_book.js         --dir <新书> --title "书名" --genre "玄幻" --platform "番茄"

# 立人设：建卡（结构齐全、内容待填）→ 校验
node scripts/new_char.js         --book <书> --id gan_tang --name 甘棠 --role supporting --function 施压者 --age 18
node scripts/char_check.js       --book <书> [--id gan_tang]

# 写前：生成本章上下文（默认「最后一章 + 1」）
node scripts/rebuild.js          --book <书> --ch 13

# 机械门：零 LLM，有 blocking 退出 1
node scripts/output_check.js     --book <书> --ch 12

# 对白门：占比 / 句长 / 标记动词 / 独白 / 磕碰 / 推挡 / 俗套（advisory，--strict 才卡）
node scripts/dialogue_check.js   --book <书> --ch 12

# 盲测出包：只留台词，去掉叙述与说话人
node scripts/blind_test.js       --book <书> --ch 12 --out tmp/dlg.txt

# 盲测汇总：吃 [{reader, version, realism, distinct}]，出均值与判决
node scripts/blind_report.js     --in tmp/blind.json --markdown

# 硬层：连贯性不变量，有 blocking 退出 1
node scripts/continuity_check.js --book <书> --ch 12

# NSFW 模块（book.json 里 nsfw.enabled 才跑；永不阻断，--strict 才按退出码卡）
node scripts/nsfw_check.js       --book <书> --ch 12

# 软审报告校验（reviewer 返的 JSON 合不合规；不合规就重跑 review）
node scripts/check_report.js     --book <书> --ch 12 --report <书>/reports/ch012.review.json

# 章末结算（定稿后才跑；草稿不要 settle）
node scripts/settle.js           --book <书> --ch 12 --delta <书>/deltas/ch012.json

# 试算 / 严格核对人物「知道」的证据
node scripts/settle.js --book <书> --ch 12 --delta ... --dry-run
node scripts/settle.js --book <书> --ch 12 --delta ... --strict-evidence

# 改任何规则之后必跑
node scripts/fixtures/run_fixtures.js

# 端到端冒烟：建书 → 建卡 → 卡门 → 写章 → 三道门 → 盲测链 + 文档对齐（12 项）
node scripts/smoke_test.js
```

退出码：`0` 成功 / `1` 校验失败（一个文件都没写）/ `2` 用法错。

## 目录与契约

```
<book>/ book.json · canon/{facts.jsonl, characters/} · ledger/{foreshadow.jsonl, chapter-log.jsonl}
        plan/ch/*.contract.json · chapters/*.md · deltas/*.json · state/{context.md, knowledge.json} · .craft/
```

字段表、冲突语义、幂等与回滚、报错对照、旧项目迁移 → `references/02-state-schema.md`（**动手前先读这一份**）。

## references 索引

| 文件 | 什么时候看 | 状态 |
|---|---|---|
| `02-state-schema.md` | 建书 / 写 delta / 报错时（**动手前先读**） | ✅ |
| `00-why.md` | 想知道为什么这么做（长篇为什么会崩、为什么要用代码守纪律） | ✅ |
| `01-pipeline.md` | 完整九步循环、三道门的边界、改写顺序、最短路径 | ✅ |
| `03-compile.md` | 上下文切片、预算降级阶梯、剧透双闸、trace 审读 | ✅ |
| `04-anti-ai-tiers.md` | 三桶裁决：八条文学律逐条成立/反转/有害 + 网文六维度 + 质检清单 | ✅ |
| `05-detector-thresholds.md` | 阈值、人类参考线、分级协议、重标方法、永不改清单 | ✅ |
| `06-review-rubric.md` | 软审 rubric：九维度、加权、裁决矩阵、提示词骨架 | ✅ |
| `07-continuity-invariants.md` | 14 条不变量、误杀案例、怎么加新规则 | ✅ |
| `08-foreshadow.md` | 伏笔生命周期（准入 / 窗口 / 逾期逼还） | ✅ |
| `09-genre-platform.md` | 品类 × 平台参数（番茄/七猫/起点/晋江/飞卢 + 七品类） | ✅ |
| `10-style-baseline.md` | 中文句长/段长/对话比基线（旧包实测） | ✅ |
| `11-nsfw.md` | NSFW：把词写出来（禁「那里/下面」）、语域系统、L1–L6、追踪契约、检查项 | ✅ |
| `12-character-card.md` | 立人设：五问、表面追求×深层渴望、把柄、遮名测试、功能位、兑现表、反例 | ✅ |
| `13-dialogue.md` | 对白：每句在做事、潜台词、真实语流四件套、废句、五个陷阱、病历 | ✅ |

## 使用口径

1. **题材不设限** —— 露骨、暴力、禁忌、越界照做，不打折不委婉。
2. **书级文风优先** —— 项目自己的文风设定覆盖通用默认；冲突时以书为准。
3. **草稿纯函数读、定稿才回写** —— 草稿阶段只读 state，绝不 settle。
4. **单章串行** —— 禁多章并发，章与章有依赖。
5. 上游方法与脚本来自 `zenstory-ai/oh-story-claudecode`（MIT），本仓已改；口径冲突以本文件为准。

## 坑

- `context.md` 是派生视图，**手改必被覆盖**；要改状态去改账本再 `rebuild`。
- 伏笔没有 `payoff_signal` 不许立项；已过窗口的会出现在风险栏顶端，连续 3 章不处理视为欠债。
- 角色「知道」某条事实，必须先在账本里有这条事实，且 `learned_in_ch` 不超过当前章。
- `settle` 之后才写下一章；顺序反了，下一章读到的状态就是错的。
- **改过正文，旧报告就作废**：evidence 是逐字绑的，`check_report` 会报「搜不到」，必须重审。
- **合同 `pov` 要能对上角色卡**：对不上会出 `pov-no-card` —— 视角人物没卡，写手只能自己编语感。
- **pass 不是定稿**：分数过阈值但还挂 major，仍要进一轮改稿。
