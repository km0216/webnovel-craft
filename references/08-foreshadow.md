# 08 · 伏笔

> 伏笔不是「埋个东西」，是一笔**有期限的债**：埋下时必须写清「怎么还」，到期不还就是欠债。
> 连载崩掉的最大来源不是忘设定，是「埋了不收」和「收了没证据」。

## 1. 生命周期

```
setup ──hint──> hinted ──ready──> pending_payoff ──payoff──> paid_off
  └──────────────┴──────────────┴──fail──> failed
```

只能前进，不能倒退。跳步会被 `settle` 拒绝（`setup` 不能直接 `payoff`）。

| 状态 | 含义 | 谁推进 |
|---|---|---|
| `setup` | 已埋，读者还不知道它有意义 | 写作时以 `op: plant` 立项 |
| `hinted` | 有第二次暗示，读者开始记着 | `op: hint` |
| `pending_payoff` | 已经推到台前，读者在等答案 | `op: ready` |
| `paid_off` | 已兑现，必须带 `evidence` | `op: payoff` |
| `failed` | 放弃回收，必须写 `reason` | `op: fail` |

## 2. 立项准入（三道）

1. **有回收信号**（`payoff_signal`）：一句话说清「回收时读者会看到什么」。写不出来 → 这不是伏笔，是气氛描写，别立项。
2. **有兑现窗口**（`payoff_window`）：`[起始章, 截止章]`。截止章不能在过去。
3. **不是重复家族**：同一类悬念已经有一条在跑，要么合并，要么把新的标成 `idea` 不进账本。

## 3. 回收必须带证据

`op: payoff` 必须给 `evidence`：**谁拿到什么证据、关掉了哪个疑问**。

- ✅「她看见信封上写着苏野的名字」→ 关掉「谁寄的」
- ❌「原来一切都有了答案」→ 没关掉任何具体疑问

`rebuild` 会把逾期伏笔置顶，`continuity_check` 会把 ≥3 章逾期升为 blocking——这是**逼还**，不是提醒。

## 4. 三种常见错法

| 错法 | 症状 | 改法 |
|---|---|---|
| **埋了不收** | 账本里挂着 20 条 `setup`，没有一条有窗口 | 立项时就要窗口；没有窗口的降级成 `idea` |
| **提前泄底** | 读者/角色太早知道答案 | 用 `visible_from_volume` 把事实锁在后面的卷 |
| **收了不算** | 正文里点了一句就算回收 | 没有证据链不算回收，状态不许置 `paid_off` |

## 5. 与三视角的关系

| 问题 | 记在哪 |
|---|---|
| 这封信是谁寄的（真相） | `facts.jsonl`，`canon_status: canon` |
| 她想不想知道（角色认知） | `characters[].known` / `misbeliefs` |
| 读者晓不晓得 | `chapter-log[].reader_known` |

**戏剧反讽**来自三者错位：读者知道而角色不知道（悬念），角色错信而真相相反（反转），作者知道而读者不知道（伏笔）。

## 6. 操作

```bash
# 立项（第 12 章）
node scripts/settle.js --book <书> --ch 12 --delta <书>/deltas/ch012.json
#   delta.foreshadow = [{ "id":"X5", "op":"plant", "content":"...", "payoff_window":[18,24], "payoff_signal":"..." }]

# 回收（第 21 章）
#   delta.foreshadow = [{ "id":"X5", "op":"payoff", "evidence":"正文里那次对质" }]

# 查当前欠债
node scripts/rebuild.js --book <书> --ch 22    # 看「活跃伏笔（逾期置顶）」
node scripts/continuity_check.js --book <书> --ch 22
```

## 7. 数量控制

- 同时活跃 ≤ 8 条（超过就有一条变成噪音）
- 每 5 章至少推进 1 条（hint / ready / payoff）
- 一卷结束前，本卷埋的必须回收或明确 `fail`
