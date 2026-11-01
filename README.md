# webnovel-craft

**长篇连载的工程化技能：状态账本 + 章节门禁 + 去 AI 味判据 + 独立软审。**

不是「一键生成小说」。它解决的是两个具体问题：

1. **写到一半记不住** —— 人设漂移、伏笔不收、设定打架
2. **改来改去还是像 AI** —— 而且越改越空

做法：人定骨架、代码守纪律、AI 只填细节。

```
写前 → 读上下文 → 起草 → 机械门 → 硬层 → 软审 → 改稿 → 结算 → 为新章准备
```

---

## 它凭什么

**长篇会崩不是窗口不够，是让它靠记忆写。** 上下文是工作记忆，清一次就真没了。主流做法收敛成四条：状态外置、每章回写、按需注入、门禁拦截。这个项目把四条做成文件 + 脚本。

**去 AI 味有一半的流行清单是错的。** 按「句长要参差」「别凑三点」「少用被动句」改，会把人的正常写法删掉。本项目里有一张 **永不改** 表：每条都附实测（句长 CV 人类与 AI 差 0.87×，破了句长反而更糟；人类比 AI 更爱用被动句）。判据只收两类——**有倍率的**，和**能指出触发标记的**。

**审稿的不许是写稿的那个。** 软审是独立上下文里的 reviewer，只返固定字段 JSON，不改稿、不评分文笔。它返回的报告会被 `check_report.js` 校验：`evidence` 必须在正文里逐字搜得到，分数与裁决必须自洽，编一条就判不合规。

## 三条铁律

1. **状态在文件里，不在对话里。** 写前只读 `state/context.md` 与本章合同；写完必须结算。只回一句「我记得」等于没做。
2. **不能让的事交给代码。** 禁区、字数、伏笔到期、设定矛盾、剧透、角色不该知道的——全走脚本。写进 prompt 当「已执行」是伪约束。
3. **改稿是减法且保守。** 指不出触发标记就别动；改完跑反向门（改过头会变电报体）；净改善才落地。

## 装

零依赖，只要 Node ≥ 18。

```bash
git clone <this-repo> webnovel-craft
cd webnovel-craft
node scripts/fixtures/run_fixtures.js      # 先验：36 项应该全绿
```

放进你的技能目录（DeepSeek Harness / Claude Code 的 `skills/` 都认这个 frontmatter 格式）。

## 用

```bash
S=scripts

# 建书（平台参数自动预置）
node $S/new_book.js --dir ~/my-novel --title "书名" --genre "玄幻" --platform "番茄"

# 写前：生成本章上下文
node $S/rebuild.js --book ~/my-novel --ch 1

# 写完：三道门
node $S/output_check.js      --book ~/my-novel --ch 1    # 字数/泄漏/禁区/占位/退化/AI 句式
node $S/continuity_check.js  --book ~/my-novel --ch 1    # 14 条不变量 + 视角泄漏 + 伏笔逾期
node $S/nsfw_check.js        --book ~/my-novel --ch 1    # 情欲语域（可选模块）

# 软审（独立 reviewer）→ 校验报告
node $S/check_report.js --book ~/my-novel --ch 1 --report reports/ch001.review.json

# 定稿后结算
node $S/settle.js --book ~/my-novel --ch 1 --delta deltas/ch001.json
```

退出码：`0` 通过 / `1` 有阻断（一个文件都没写）/ `2` 用法错。

完整流程见 `references/01-pipeline.md`；数据契约见 `references/02-state-schema.md`（动手前先读这份）。

## 它管什么、不管什么

| 能保证 | 保证不了 |
|---|---|
| 设定不矛盾、伏笔不丢、时间线不错乱、人物不换人格 | 好看 |
| 角色不提前知道结局 | 爽点不俗 |
| 改稿有判据、改完能复扫 | 语感像人、有梗 |

**工程管下限，上限是作者的事。** 反过来也成立：连下限都不稳的书，再好的构思也会被读者当成乱写。

## 目录

```
SKILL.md                技能入口：三条铁律 / 门禁表 / 命令
references/             12 份：为什么、流程、契约、三桶裁决、阈值、rubric、不变量、伏笔、品类平台、基线、NSFW
scripts/                11 个零依赖脚本 + fixtures 回归
templates/              书配置、章节合同、角色卡、delta、软审报告、示例词库
examples/demo-book/     能跑的最小样例（三章）
```

## 关于成人内容

技能里带一个 NSFW 模块（语域系统 + 场景分级 + 词表），**默认关闭**，`book.json` 里 `nsfw.enabled: true` 才生效。
它判的是「这个词在这本书里合不合」，不是禁词表——同一个词在白文里是回避，在古言里是风格。
仓库不含小说正文。

## 数据从哪来

判据不是拍脑袋来的。每条阈值都标了出处与置信度，语料没公开的（如 lieflat 的倍率）按「仓库自述」引用。详见 `NOTICE.md` 与 `references/05-detector-thresholds.md`。

## 许可

MIT。上游 `oh-story-claudecode` 的代码按 MIT 使用，许可见 `LICENSE-上游-MIT.txt`。
