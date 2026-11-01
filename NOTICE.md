# NOTICE · 来源与许可

本项目的部分代码与判据来自第三方，按原许可使用：

## 代码

- **check-ai-patterns.js / check-degeneration.js / normalize-punctuation.js / style-whitelist.js**
  来自 [worldwonderer/oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode)（MIT）。
  已按本项目口径修改：阈值重标、白名单接入 book.json、去掉章节流程耦合。
  原许可全文见 `LICENSE-上游-MIT.txt`。

## 判据与数据

- **[lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)**
  中文 AI 味的人类参考线与倍率、X 级「永不改」表、A/B/C/H/X/F 分级协议。
  该项目自述语料未公开，其倍率我们按「仓库自述」引用，未独立复核。

- **[MrGeDiao/shuorenhua](https://github.com/MrGeDiao/shuorenhua)**
  误改率门槛（<10%）与发布硬门槛的判据来源。

- **网文抽样基线**（句长、段长、对话比、删减上限）
  来自本机对公开中文网文的统计，样本不随项目分发；数字写在 `references/10-style-baseline.md`，标注为「参考线不是配额」。

## 本项目自有的

`settle.js` / `rebuild.js` / `continuity_check.js` / `output_check.js` / `check_report.js` / `nsfw_check.js` / `new_book.js`、
12 份 references、templates、fixtures 与回归脚本。

## 成人内容声明

`templates/nsfw-lexicon.json` 含中文情欲场景的词汇表，`references/11-nsfw.md` 是该模块的规则文档。
该模块**默认不加载**（`book.json` 里 `nsfw.enabled` 为 false 时，检查脚本直接跳过）。
词汇表是工具的一部分，供成人向虚构写作使用；仓库本身不含任何小说正文。

## 其它

- `unslop`、`stop-slop` 仅作词表来源参考，其规则未被当作判据（无实测支撑）。
- 本项目不含任何第三方小说正文；`fixtures/negative_clean/` 是自写的中性样本。
