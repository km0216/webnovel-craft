# 06 · 软审 rubric

> 审校是**找问题**，不是验证正确。reviewer 只返问题清单：不改稿、不评分「文笔好不好」、不建议改情节、不持写权限。
> **reviewer ≠ writer**：同一口气审自己的稿，永远「差不多可以」。

## 1. 边界

| reviewer 做 | reviewer 不做 |
|---|---|
| 按固定维度找问题，给证据 | 改正文 |
| 判「这条合同里的节点覆盖了吗」 | 判「这个点子好不好」 |
| 判「爽点兑现了吗、钩子有吗」 | 判「这个钩子俗不俗」（人判） |
| 引用账本判一致性 | 自己推断设定 |
| 输出固定字段 JSON | 输出散文评语 |

**输入的洁净**：只给它 `state/context.md` + 本章合同 + 本章正文 + 上一章最后 300 字。
不给它「上一轮评审意见」（会锚定），不给全书（会稀释）。

## 2. 输出 schema（固定，多一个字段都算不合规）

```json
{
  "chapter": 12,
  "verdict": "pass | revise | rewrite",
  "scores": {
    "sao_payoff": 0, "opening_hook": 0, "pacing_density": 0,
    "no_poison_points": 0, "emotion_immersion": 0, "ending_hook": 0,
    "prose_ai": 0, "pov_discipline": 0, "info_release": 0
  },
  "issues": [
    {
      "severity": "blocking | major | minor",
      "category": "continuity | character | pacing | sao | hook | poison | pov | prose_ai | info_release",
      "evidence": "正文里的原句（必须能原样搜到）",
      "why": "一句话：违反了什么判据",
      "fix_hint": "一句话：往哪个方向改（不写具体句子）",
      "blocking": true
    }
  ]
}
```

校验：`node scripts/check_report.js --book <书> --ch 12 --report reports/ch012.review.json`

## 3. 九个维度（0 = 踩雷 / 1 = 及格 / 2 = 优秀）

| 字段 | 判什么 | 跌 0 的典型 |
|---|---|---|
| `sao_payoff` | 本章有可感知的「爽」或「推进的快感」 | 整章读着平，没有任何兑现 |
| `opening_hook` | 前 300 字有没有抓人的东西 | 从起床/走路/介绍自己开始 |
| `pacing_density` | 信息与事件的密度 | 一段话绕三遍说同一件事 |
| `no_poison_points` | 毒点（绿帽/送女/降智/圣母/种马/反三观） | 主角被耍还笑；配角智商掉线 |
| `emotion_immersion` | 读者能不能代入主角 | 主角像个旁观者 |
| `ending_hook` | 章末留没留下「继续」的理由 | 自然收束、情绪落地 |
| `prose_ai` | 读着像不像机器写的 | 华美空洞、翻译腔、解释腔 |
| `pov_discipline` | 一章一 POV，没跳头 | 「殊不知」「与此同时，山的那边」 |
| `info_release` | 信息放得对不对（该给的给了、该藏的藏了） | 金手指迟迟不露 / 三章内把底全交了 |

**加权**：`sao_payoff`、`pacing_density` 权重 2；`prose_ai`、`pov_discipline` 权重 1.5；其余 1。
加权平均 < 1.0 → `rewrite`；< 1.5 → `revise`；否则 `pass`。

## 4. 裁决矩阵（谁能不能拦）

| 情况 | 裁决 | 谁拦 |
|---|---|---|
| 任一维度 = 0 且 `category` 是 `poison` | **blocking** | 硬门，必须重写该段 |
| 有 `blocking: true` 的 issue | **blocking** | 同上 |
| 加权 < 1.5 | revise | 进改稿循环（≤3 轮） |
| 只有 minor | pass（带着建议走） | 可选修 |

**reviewer 的分数不是终审**：机械门（`output_check`）与硬层（`continuity_check`）的判决不可被高分覆盖；反过来，软审说「很好」也不能让机械门的 blocking 消失。

## 5. 反模式（模型写评审时最容易犯）

- 写一段「整体读来流畅，但…」的散文 → 改成 issues 数组
- `evidence` 编造原句 → 校验器会核对它是否真在正文里，编的直接判不合规
- 把「我建议改得更生动」当 fix_hint → 必须是方向，不是口号
- 给满分以图省事 → 评分必须能和 issues 对上（有 blocking 却全给 2 分 = 不合规）
- 审判口味（「这个比喻不好」）→ 只能判判据（贴不贴切归人）

## 6. 提示词骨架（复制即用）

```
你是审校，不是作者。只读下面的材料，只输出 JSON，不写任何解释性文字。

材料：
[上下文] {state/context.md}
[本章合同] {plan/ch/chNNN.contract.json}
[上一章结尾 300 字] {...}
[本章正文] {chapters/chNNN.md}

判据：
- 九个维度见 references/06-review-rubric.md，每项 0/1/2
- issue.evidence 必须是正文里能原样搜到的片段，不许改写、不许编
- 只判「合同要求的东西做到没有」和「读感上的硬伤」，不判口味、不改稿

输出：严格按照 references/06-review-rubric.md §2 的 JSON schema。
```

## 7. 和门禁的接法

```
机械门（脚本） → 硬层（脚本） → 软审（本文件） → 改稿（≤3 轮，每轮回机械门）
```

三层的判决各自独立，**任何一层 blocking 都不许被另一层的好评覆盖**。
改稿后必须重跑机械门与硬层——改句子会动到句子承载的信息。
