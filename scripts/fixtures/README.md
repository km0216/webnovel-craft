# fixtures · 负样本回归

**改任何规则或脚本之后必跑**：`node scripts/fixtures/run_fixtures.js`

判据不是「检出了多少」，是「**没检错的**」：人类正常稿必须 0 条 blocking，负样本必须按预期失败。误杀高的检测器没人敢用，等于没有。

## 目录

| 路径 | 是什么 | 期望 |
|---|---|---|
| `negative_clean/` | 人类网文正文 10 章（取自 `某部连载`，14.7 万字体量的子集；含合法破折号、长段、方言、口语） | 检测器 **0 blocking**；advisory 允许少量 |
| `positive/` | 已知 AI 味样本（待批 2 补） | 每条触发器都要中 |
| `negative/delta-conflict.json` | 不声明 `supersedes` 就改既定事实 | `settle` 拒绝，exit 1 |
| `negative/delta-foreshadow-jump.json` | 伏笔从 `setup` 直接 `payoff` | `settle` 拒绝，exit 1 |

## 加新用例

1. 把能复现问题的稿子放进来（脱敏，别放没授权的真人素材）
2. 在 `run_fixtures.js` 里加一条 `check(...)`，写清「为什么这条必须失败/必须通过」
3. 先确认它在**旧规则**下会挂，再改规则让它过——否则说明这条用例没测到东西

## 不准做的事

- 为了让用例通过而改用例（改测试不改代码）
- 放宽阈值到「什么都不报」来换全绿——那等于关掉检测
- 拿单个样本外推：一条样本只能证明「这条规则在这个样本上如何」
