# 02 · 状态契约

> 唯一权威是 `canon/` + `ledger/` 几个文件；`state/` 是派生视图，改了就下次被覆盖。
> 写前只读 `state/context.md` + 本章合同；写后必须 `settle`。只回一句「我记得」等于没做。

## 1. 书目录

```
<book>/
  book.json                      # 书级配置，覆盖一切默认值
  canon/
    facts.jsonl                  # 事实账本（只追加）
    characters/<id>.json         # 角色卡：稳定人设 / 当下状态 / 认知边界
    style-sample.md              # 文风样本（喂给写手的就是这段）
  ledger/
    foreshadow.jsonl             # 伏笔台账（状态机）
    chapter-log.jsonl            # 每章结算摘要（近章速记的来源）
  plan/ch/chNNN.contract.json    # 章节合同（写前定，写后核）
  chapters/chNNN.md              # 正文
  deltas/chNNN.delta.json        # 本章增量（settle 的输入，可留档）
  reports/chNNN.review.json      # 软审报告（批 2）
  state/
    context.md                   # 派生：注入用上下文（≤8 KB）
    knowledge.json               # 派生：三视角快照
  .craft/                        # 注入包、trace、结算日志、备份
```

## 2. `book.json`

| 键 | 类型 | 说明 |
|---|---|---|
| `title` / `genre` / `platform` | string | 书名 / 品类 / 平台（平台决定节奏参数） |
| `pov` | string | `third-limited` / `first` |
| `word_window` | [int,int] | 单章字数窗口，默认 [2000,3000] |
| `volume_starts` | [int…] | 每卷起始章，如 `[1,21,41]`；决定卷号与剧透闸 |
| `sacred` | [string…] | 不可推翻的长期约束（每章都进上下文，预算再紧也保留最少 6 条） |
| `style_sample` | path | 文风样本文件 |
| `whitelist` | [string…] | 专名/术语白名单，词句层检测必须跳过 |
| `thresholds` | object | 检测阈值覆盖（见 `05-detector-thresholds.md`） |
| `hook_types` | [string…] | 本书允许的章末钩子类型 |

## 3. `canon/facts.jsonl`（一行一条，只追加，改事实 = 追加 + 盖终点）

| 字段 | 必填 | 语义 |
|---|---|---|
| `id` | ✓ | 稳定 ID（`F` + 序号），正文可引 `{F17}` |
| `subj` / `pred` / `obj` | ✓ | 主体·谓词·客体。「苏念·住在·里屋」 |
| `cardinality` | | `single`（默认，同 subj+pred 只能一个值）/ `multi` |
| `canon_status` | | `canon`（默认）/ `pending` / `rejected` / `idea` / `inferred`。**只有 canon 会注入** |
| `valid_from_ch` | | 从第几章为真，默认当前章 |
| `valid_until_ch` | | 到第几章为止；`null` = 仍有效。**失效只盖终点，不删记录** |
| `visible_from_volume` | | 剧透闸：最早第几卷可注入，默认 1 |
| `source_ch` | | 哪一章立下 |
| `evidence` | | 原文片段；`--strict-evidence` 会核对它在正文里真实存在 |

**冲突规则**：同一 `subj`+`pred` 的 `single` 事实若已有有效旧值，新值必须带 `supersedes: ["F1"]`，否则 `settle` 拒绝。带了就自动给旧的盖 `valid_until_ch = 本章 - 1`。

## 4. `canon/characters/<id>.json`

```
stable  稳定人设（不随剧情变）
  motivation / goal / conflict / arc     四要素
  anchors[]                              行为锚点：「他不会做 X」「逼急了会 Y」
  lines[]                                台词样本，定腔调（写手照着这个语感写）
state   当下状态（每章可被 delta 覆盖）
  location / goal / relations{} / power / items[] / conditions[]
known[]             [{fact_id, learned_in_ch, how}]  只能由写出场景后登记
misbeliefs[]        [{belief, since_ch, corrected_in_ch}]  他**错误相信**的事
forbidden_knowledge[] [fact_id]  结构性保证他不知道（编译器硬过滤，批 2 生效）
```

**硬规矩**：`known.learned_in_ch` 必须 ≤ 当前章；引用的 `fact_id` 必须先在账本里存在。这一条挡住连载里最常见的「角色提前知道结局」。

## 5. `ledger/foreshadow.jsonl`

| 字段 | 说明 |
|---|---|
| `id` / `content` | `X` + 序号；伏笔一句话 |
| `planted_ch` | 埋设章 |
| `state` | `setup` → `hinted` → `pending_payoff` → `paid_off` / `failed`，**只能前进** |
| `payoff_window` | `[起始章, 截止章]`，过了就是 `overdue` |
| `payoff_signal` | 回收时读者该看到什么。**没有信号不许立项**（防「埋了不收」） |
| `payoff_ch` / `evidence` | 实际回收章与证据（谁拿到什么、关掉哪个疑问） |
| `history[]` | 每次状态变更流水 |

操作走 delta 的 `foreshadow[].op`：`plant` / `hint` / `ready` / `payoff` / `fail`。跳步会被拒（`setup` 不能直接 `payoff`）。

## 6. `plan/ch/chNNN.contract.json`

`goal` · `must_cover_nodes[]` · `must_preserve[]` · `forbidden_zones[]` · `required_appearances[]` · `required_payoffs[]` · `pov` · `time_anchor` · `word_window` · `end_hook_type` · `next_chapter_commitments[]`

写稿、门禁、审稿、修稿**共同消费这一份**。上一章的 `next_chapter_commitments` 会进下一章的上下文。

## 7. delta（`settle` 的输入）

```json
{
  "chapter": 12,
  "summary": "三句话：谁的状态变了 / 哪个伏笔动了 / 哪条冲突推进了",
  "facts": [{ "id": "F9", "subj": "", "pred": "", "obj": "", "supersedes": ["F4"] }],
  "facts_retire": [{ "id": "F4", "until_ch": 11, "reason": "" }],
  "foreshadow": [{ "id": "X2", "op": "plant", "content": "", "payoff_window": [15, 20], "payoff_signal": "" }],
  "characters": [{ "id": "sunian", "state": { "location": "" }, "known": [{ "fact_id": "F9", "learned_in_ch": 12, "how": "" }], "misbeliefs": [{ "belief": "", "since_ch": 12 }] }],
  "reader_known": [{ "fact_id": "F9", "revealed_in_ch": 12 }]
}
```

- `summary` 必填、≤200 字；没有它账本就长不出「近章速记」
- **草稿阶段不要 settle**，定稿才提交（草稿反复重生成不该污染长程状态）

## 8. 三视角

| 视角 | 存在哪 | 谁写 |
|---|---|---|
| 作者确认真相 | `facts.jsonl`（`canon_status: canon`） | settle |
| 角色的认知 | `characters[].known` / `misbeliefs` / `forbidden_knowledge` | settle（必须带 `how`） |
| 读者已被展示的 | `chapter-log.jsonl` 的 `reader_known` | settle |

`state/knowledge.json` 是把三者摊平的快照，供 `continuity_check`（批 2）与 review 引用。

## 9. 幂等与回滚

- 同一 `delta` 文件提交两次 → 第二次识别为「已结算」，exit 0，不重复写
- 每章另交不同 delta → 允许（追加提交），但会警告「确认不是重复写两遍」
- 写盘前把受影响文件复制到 `.craft/backup/<时间戳>/`；写失败照原样恢复
- 所有写都是「写临时文件 + rename」，断电不会留半截 JSON

## 10. 报错对照

| 报错 | 怎么办 |
|---|---|
| `「X·Y」与 F4（=里屋）冲突` | 这是本章的变化 → 加 `supersedes: ["F4"]`；不是变化 → 别写这条 |
| `known[0].fact_id=F9 不在账本里` | 先在本章 `facts` 里登记这条事实，再让人物知道 |
| `known[0].learned_in_ch 必须是 ≤N` | 角色不许提前知道；改小或挪到后面的章 |
| `foreshadow[1] X2 当前状态 setup，不能执行 payoff` | 状态机只能前进：先 `hint` 再 `ready` 再 `payoff` |
| `payoff_window 截止章 5 早于当前章 6` | 埋设时窗口就不能在过去 |
| `没有 evidence`（warning） | 补原文片段，否则审校时无法回溯 |

## 11. 从旧项目迁移

旧包是「`上下文.md` + `伏笔.md` 两份自由文本」：

1. `上下文.md` 的「长期约束」→ `book.json.sacred`；「当前位置/角色状态」→ 各 `characters[].state`
2. `伏笔.md` 每一行 → `foreshadow.jsonl` 一条，`state` 按「埋了没回收=setup / 有暗示=hinted / 快收了=pending_payoff」判；**没有回收信号的老伏笔，现在补上或标 `failed`**
3. 旧正文里的既定事实 → 逐条 `facts.jsonl`，`valid_from_ch` 填它第一次成立的章
4. 跑一次 `rebuild.js` 看 `context.md` 是否还原了旧的那份；对不上说明迁移漏了东西
