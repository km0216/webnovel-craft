# webnovel-craft

给长篇网文用的写作工程：**人定骨架，代码守纪律，AI 只填细节**。

它保证不了「好看」——那靠人在大纲层定。它保证的是：不崩设定、不丢伏笔、不错时间线、不换人格、不写成念稿腔。

## 它解决什么

| 长篇会出的问题 | 这里的做法 |
|---|---|
| 写到 50 章，前面受过的伤忘了 | `canon/` + `ledger/` 账本，每章 `settle` 回写 |
| 伏笔埋了不收 | 伏笔状态机 + 到期窗口，逾期升 blocking |
| 角色提前知道结局 | 三视角分离：作者真相 / 角色认知 / 读者已知 |
| 人物卡是一串形容词 | 五问：想要什么 / 缺什么 / 怕什么 / 谁能拿捏 / 出事第一反应 |
| 对白人人金句 | 推挡、废句、遮名测试 + 结构检查器 |
| 情欲场写成清单 | 节律、身体信号、语言衰减、死线 |
| 改稿改到崩 | 机械门 → 硬层 → 对白门 → 软审，四层判决互不覆盖 |

## 快速开始

```bash
# 建一本新书（平台参数自动预置）
node scripts/new_book.js --dir ./my-book --title "书名" --genre "玄幻" --platform "番茄"

# 立人设：建卡（结构齐全、内容待填）
node scripts/new_char.js --book ./my-book --id lin_wan --name 林晚 --role supporting --function 施压者 --age 24
node scripts/char_check.js --book ./my-book

# 写前：生成这一章的上下文
node scripts/rebuild.js --book ./my-book --ch 1

# 写完：四道门
node scripts/output_check.js     --book ./my-book --ch 1
node scripts/continuity_check.js --book ./my-book --ch 1
node scripts/dialogue_check.js   --book ./my-book --ch 1
node scripts/nsfw_check.js       --book ./my-book --ch 1   # 仅成人向书

# 定稿：结算 + 为下一章准备
node scripts/settle.js  --book ./my-book --ch 1 --delta ./my-book/deltas/ch001.json
node scripts/rebuild.js --book ./my-book --ch 2
```

完整的九步循环见 `references/01-pipeline.md`。

## 目录

```
SKILL.md              技能入口：门禁表 / 命令 / 坑
references/           14 篇方法文档（账本契约、九步循环、去 AI 味、软审、伏笔、品类、风格、NSFW、人设卡、对白）
scripts/              17 个零依赖脚本（门禁 / 编译 / 结算 / 校验 / 冒烟）
templates/            书、角色卡、章节合同、delta、软审报告、NSFW 词库
examples/demo-book/   能跑通的最小样例（三章 + 两条伏笔）
examples/cards/       填满的角色卡范例
```

## 四道门

| 门 | 判什么 | 能不能拦 |
|---|---|---|
| `output_check` | 字数窗口、指令泄漏、占位符、禁区词面、退化、AI 句式密度 | blocking，退出码 1 |
| `continuity_check` | 账本能证明的矛盾（14 条不变量 + 视角无卡） | blocking |
| `dialogue_check` | 对白占比 / 句长 / 标记动词 / 独白 / 磕碰 / 推挡 / 俗套 | advisory，`--strict` 才卡 |
| `nsfw_check` | 语域匹配、强度等级、代称、凑词、字数规格 | advisory，`--strict` 才卡 |

外加：`char_check`（角色卡结构）、`check_report`（软审报告校验，证据必须能在正文里原样搜到）、`blind_test` / `blind_report`（对白盲测）。

## 测试

```bash
node scripts/fixtures/run_fixtures.js   # 57 项正负样本
node scripts/smoke_test.js              # 12 项端到端冒烟（含文档与脚本对齐）
```

阈值不靠拍：`references/05-detector-thresholds.md` 与 `10-style-baseline.md` 里的数字来自中文网文人类样本统计，`dialogue_check` 的阈值按同一批 10 篇人类稿校准（对白占比 27.7–41.1%、平均句长 5.6–8.4 字）。

## 关于成人向模块

仓库包含 `references/11-nsfw.md` 与 `templates/nsfw-lexicon.json`（成人向写作的语域与用词判定表）。

- **默认不加载**：只有 `book.json` 里 `nsfw.enabled: true` 才生效
- **角色一律成年**：`char_check` 对成人向卡强制 `age ≥ 18`，不因为题材是二次元或虚构而放宽
- 它判的是「这个词在这本书、这场戏、这个人嘴里合不合」，不是给你一份禁词表

## 许可

- 本仓新增部分：MIT（见 `LICENSE`）
- 上游方法与部分脚本来自 [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)（MIT），已改写；原文见 `LICENSE-上游-MIT.txt`
