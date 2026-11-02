# 01 · 九步循环与门禁

> 草稿纯函数读、定稿才回写。热路径快写，冷路径一次结构化抽取状态。
> 单章串行——章与章有依赖，禁多章并发。

## 1. 循环

| 步 | 谁做 | 动作 | 产物 | 失败怎么办 |
|---|---|---|---|---|
| 0 | **人** | 锁顶层契约：品类 / 平台 / 核心冲突 / 结局 / 主线锚点 / 红线 | `book.json` | 没这个别开写 |
| 0.5 | **人** + 脚本 | 立人设：每张卡答完五问（`12-character-card.md`），`char_check.js` 过结构 | `canon/characters/*.json` | blocking 不修完不开写 |
| 1 | 脚本 | `rebuild.js --ch N` 编译最小上下文 | `state/context.md` + `knowledge.json` | 缺合同就补合同 |
| 2 | 写手 | 只读 `context.md` + 本章合同，按蓝图填正文 | `chapters/chNNN.md` | 不许在草稿阶段 settle |
| 3 | 脚本 | `output_check.js` 机械门（字数/泄漏/禁区/占位/退化/AI 句式） | 列表 | 有 blocking → 就地改，不算「去 AI 味」 |
| 4 | 脚本 | `continuity_check.js` 硬层（14 条不变量） | 列表 | blocking → 改正文或补账本 |
| 5 | 独立 LLM | 软审 rubric（`06-review-rubric.md`），只返 JSON | `reports/chNNN.review.json` | 不通过 → 进第 6 步 |
| 6 | 写手 | ≤3 轮定向修；每轮回到第 3 步 | 新版本 | 净改善 ≥ ε 才采纳，否则回退 |
| 7 | 写手 | 桶 1 剩项逐条改 → 复扫 → 反扫「电报体」 | 干净正文 | 改过头就补回自然白话 |
| 8 | 脚本 | `settle.js` 结算 delta | 账本更新 | 冲突 → 加 `supersedes` 或别写这条 |
| 9 | 脚本 | `rebuild.js` 重建视图 + `git commit` | 下一章的上下文 | 风险栏有东西 → 当场处理 |

**顺序不能换**：先 3 后 4 是因为机械门便宜；先 4 后 5 是因为硬层能挡掉的别浪费 LLM。

## 2. 三道门的边界

| 门 | 判什么 | 绝不判什么 |
|---|---|---|
| 机械门（`output_check`） | 字数、泄漏、占位、禁区词面、退化、AI 句式密度 | 好不好看、人物像不像 |
| 硬层（`continuity_check`） | 账本能证明的矛盾 | 语气、节奏、爽点 |
| 软审（rubric） | 结构、爽点、钩子、毒点、视角、对话区分度 | 设定事实（那是账本的事） |

**伪约束禁令**：任何「必须」若不是脚本能验的，就不要写成「必须」。写进 prompt 当已执行，是自欺。

## 3. 改写与去味的顺序

1. **先删**：真重复、纯解释、无功能修饰
2. **再换**：抽象 → 具体；书面 → 口语；贴标签 → 动作
3. **最后调**：句长与节奏**只在该调的地方**调；不要为「参差」而拆句
4. 每改完一轮 → 重跑第 3、4 步（改句子会动到句子承载的信息）
5. 改完连读一遍：像提纲 = 改过头，把非峰值句补回自然白话（「了/的/就/的时候」），不是接着删

## 4. 采纳门槛

- 每轮修完重打分；`score_after ≥ score_before + ε`（ε=1）才落地，否则回退
- 同章定向修 ≤3 轮；3 轮没净改善说明问题不在句子层（回去改合同或大纲）
- 所有改动留档：谁改的（规则编号）、改前改后、为什么

## 5. 一次写完一章的最短路径

```bash
node scripts/char_check.js    --book <书>                  # 0 卡门（写前一次）
node scripts/rebuild.js       --book <书> --ch 12          # 1 读上下文
#   写 chapters/ch012.md                                     2 起草
node scripts/output_check.js  --book <书> --ch 12          # 3 机械门
node scripts/continuity_check.js --book <书> --ch 12       # 4 硬层
node scripts/dialogue_check.js --book <书> --ch 12         # 4.5 对白门（advisory）
#   软审（reviewer ≠ writer）→ check_report.js               5
node scripts/settle.js        --book <书> --ch 12 --delta <书>/deltas/ch012.json   # 8
node scripts/rebuild.js       --book <书> --ch 13          # 9 为下一章准备

# 一卷收尾 / 大改后
node scripts/blind_test.js    --book <书> --ch 12 --out tmp/dlg.txt
node scripts/blind_report.js  --in tmp/blind.json --markdown
```

**改过正文就不能沿用旧报告**：报告里的 evidence 是逐字绑定，`check_report` 会报「搜不到」，重审一次。

## 6. 上下文预算

默认 8 KB（`--max-kb`）。超了按顺序砍：长期约束明细 → 事实证据 → 角色/事实条数 → 近章速记。
**禁区与活跃伏笔永远不砍**——砍了正好砍掉最该看的。
