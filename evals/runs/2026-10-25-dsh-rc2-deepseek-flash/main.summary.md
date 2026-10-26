# e2e dsh 0.2.1-rc.2 main c4d0f11, Doctor Duck 345d618 ((profile default))

48/48 checks passed; must failed 0, should failed 0

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":116842,"outputTokens":146345,"cacheReadTokens":10833152,"cacheWriteTokens":0,"totalTokens":11096339}

## idle: `帮我把 paper/main.tex 摘要的最后一句改得更紧凑一点。先在对话里给，文件先别改。` (15s)

- [x] must: hook injected the idle note, not the resident rules
- [x] must: no .duck/ folder
- [x] must: no decision line
- [x] should: does not bring up the duck
- [x] should: paper/main.tex untouched

<details><summary>reply</summary>

我先读取摘要，找到最后一句。

摘要共三句，最后一句是 `paper/main.tex:10`：

> BlockSkip significantly outperforms existing sparse attention methods and reduces inference time by 31\%.

**推荐改法（用于替换该句）：**

```latex
BlockSkip outperforms existing sparse attention methods, cutting inference time by 31\%.
```

具体做法是用分词短语 `cutting ...` 把两个并列谓语合并，省掉 `and reduces`，并去掉 `significantly`。这样句子从 14 个词减少到 11 个词，句法更紧凑，信息没有丢。

**备选（想保留 `significantly` 的语气）：**

```latex
BlockSkip significantly outperforms sparse attention methods, cutting inference time by 31\%.
```

这里只删了 `existing` 并合并谓语，语气不变，但紧凑程度不如第一版。

另外补充一点：删掉 `significantly` 之后，表述会和表 1 的数据更一致（准确率提高 0.8 点、1.45× 加速，但没有显著性检验），审稿时也不容易被追问“significantly 的依据在哪”。如果你希望保留这个词，建议在正文里补一项统计检验，或者明确说明这里的显著性指的是什么。

文件没有改动，等你确认用哪一版，我再写入。

</details>

## menu: `/duck` (17s)

- [x] must: menu lists the commands
- [x] must: says the duck is not on in this project
- [x] must: the menu did not turn it on
- [x] must: hook injected the plugin root

<details><summary>reply</summary>

Quack！我是 Doctor Duck。Trust me, I'm a Ducktor.

| 命令 | 做什么 |
|---|---|
| /duck-survey | 摸方向、文献综述 |
| /duck-idea | 评估 idea |
| /duck-outline | 理论文逻辑，技术论文和 benchmark 论文自动区分 |
| /duck-intro | 写引言 |
| /duck-write | 写正文 |
| /duck-polish | 润色 |
| /duck-figure | 设计图、出图质检 |
| /duck-review | 投稿前审稿 |
| /duck-vibe | 这块该让 AI 干到哪、用什么工具 |
| /duck-why | 拆解刚才那一步，或者指定的文件、提交、段落 |
| /duck-learn | 阶段复盘 |
| /duck-notes | 看、改笔记本 |
| /duck-skill | 管理命令和卡片 |

鸭子在这个项目**没有开启**：`.duck/config.md` 不存在（也就没有「开关：」那一行）。平时不出声，只有敲 /duck-xxx 命令时才动。

项目里也没有你自己加的 `duck-` 命令：`.claude/skills/`、`.agents/skills/` 都还不存在。

/duck on 在这个项目开启（/duck quiet 只记不说，/duck off 关掉报告）；/duck 后面接一句话，我替你挑命令。

</details>

## enable: `/duck on` (21s)

- [x] must: config says on
- [x] must: read the resident rules this turn, or the context brought them

<details><summary>reply</summary>

已开启。

`.duck/config.md` 新建好了，里面写的是：

```
开关：on
```

这一档的意思是：以后平时干活也按常驻规则来，讲为什么、记决策、结果进论文前先对标准（E05、R02、E02 那几条），每次 /duck-xxx 命令跑完出「为什么」报告，对话里放短版，完整版存进 `.duck/reports/`。从这一轮起我就照常驻规则做了。

想调的话：/duck quiet 只记不说，/duck off 关掉报告。

</details>

## idea: `/duck-idea 我想做长文本推理加速：用块均值估计注意力里每一对 64 token 的块贡献多大，贡献很小的整块跳过。目标是 7B 模型在 LongBench 上省 30% 以上时间、准确率不掉。对手是 token 级剪枝和稠密注意力。现有结果在 notes.md 里。` (249s)

- [x] must: read library/idea-evaluator
- [x] must: wrote an idea report
- [x] must: notebook got a line
- [x] should: reply has the why block

<details><summary>reply</summary>

## 1. 第一印象

- 论文类型：新方法（Novel Method）
- 一句话故事：把 64 token 块的注意力均值当作块重要性，跳过低贡献块，在 7B/LongBench 上省 31% 时间且准确率不降。
- 判断：故事能一句话说清，但和 XAttention 的差别还没说清。这是这次评估的关键。

## 2. 致命缺陷审计

| # | 缺陷 | 严重度 | 防御 |
|---|---|---|---|
| 1 | F1 和最近的工作没有区别：XAttention（Xu 等，2025）已经把「用廉价的块统计量估重要性，再跳块」做成 training-free 的 plug-and-play，且明确用 antidiagonal sum 当块重要性 proxy；你的块均值只换了统计量，没换作用对象、机制或输入粒度 | MAJOR | 用一句话说清 mean 的独立优势：更便宜（只做块内平均，不做反对角线和），或在块内单 token 高权重时更稳。并在同一 7B/LongBench、同一稀疏率下做 mean vs antidiagonal 的对照。做不到就承认这是 XAttention 的一个消融，把贡献改成「更便宜的 proxy」，不要包装成新方法 |
| 2 | F3 基线不是真基线：对手只有 token 级剪枝和稠密注意力，没有 2025 到 2026 的 block-sparse 工作（XAttention 2025、MInference 2024、PBS-Attn 2026） | MAJOR | 至少加一个 block-sparse 基线，优先 XAttention（代码公开），同模型、同 benchmark、同稀疏率；跑不动就引已发表数字并说明不是同设置，别声称 SOTA |

两个 MAJOR，没有 CRITICAL，继续往下做。

## 3. 生命周期与能力匹配

| 方面 | 你的输入 | 评估 |
|---|---|---|
| idea 类别 | 应用研究（效率方法） | 短周期 3 到 6 个月；workshop 短稿是压缩版 |
| 生命周期 | 3 到 6 个月 | 10-30 截稿，今天 10-25，只剩 5 天 |
| 每周有效小时 | 未说明 | 无法判断；已有实现和结果说明能跑 |
| 匹配 | Yellow | 时间线高风险；补基线的工程量可能吃满 5 天 |

## 4. 五维评分

| 维度 | 分数 | 证据 | 提升建议 |
|---|---|---|---|
| Higher | 6 | 「准确率 71.2，比基线 70.4 高。只跑了一次。」+0.8 分，单次运行，没有种子波动；跳计算反而涨点，先按噪声处理 | 3 个 seed，报均值±标准差，按 LongBench 子任务拆；把「不掉」改成「无显著下降」 |
| Faster | 6 | 「省 31% 时间」，刚过 30% 目标，约 1.45x；只对稠密注意力，没对 block-sparse SOTA；没说是端到端还是只算 attention | 分开报端到端和 attention-only；同设置对 XAttention/MInference；说清 31% 里有多少来自块粒度本身 |
| Stronger | 4 | 没测鲁棒性；块均值会被块内单个高权重 token 稀释（attention sink、needle），这是机制上的已知弱点 | needle-in-haystack、per-task 拆解、块内 max vs mean 的对照；至少写两个 failure mode |
| Cheaper | 6 | training-free，不用重训；但估计块重要性本身有开销，31% 是否已扣掉这笔开销不清楚 | 单独报估计开销；和 XAttention 的 antidiagonal 估计比成本 |
| Broader | 5 | 只有 7B + LongBench；没有别的模型、上下文长度或任务 | 时间够就加一个模型尺寸或 RULER；不够就明确写 scope |

主维度是 Faster，Higher 是约束。没有一维到 7，说明目前是「能省一点」，还不是「明显更好」。

## 5. 范式偏移探针

| 探针 | 回答 | 理由 |
|---|---|---|
| First Principles | Partial | 挑战了「必须 token 级细粒度」的假设，块均值够用就行；但没有挑战更底层的假设，块稀疏本身是旧想法 |
| Elephant in the Room | No | 长文本推理贵是大家都看见、且已经在猛攻的问题，不是没人碰的房间里的大象 |
| Technology Cycle | Partial | 7B 长上下文模型和 LongBench 让这件事更 timely；但 block-sparse attention 五六年前就能做 |
| Hamming's Rule | No | 一个 benchmark 上 30% 加速是增量，不会改变领域优先级 |

得分 2/8（Partial 各 1 分），纯增量。引言按增量写，主打 Faster，准确率作为约束，不要包装成范式转移。

## 6. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 算力 | Medium | 已有 7B/LongBench 结果说明跑得通；补 3 个 seed 机时×3，卡型未说明 |
| 数据 | Low | LongBench 公开 |
| 工程 | Medium-High | 自己的方法已跑通；接 XAttention/MInference 要动 kernel/Triton，5 天内风险高 |
| 时间 | High | 5 天要补 seed、基线、失败分析、写作；建议缩成 workshop 短稿，或延到下一个 deadline |

## 7. 结论

**Accept with Revisions**

不是 Strong Accept：没有一维到 8，且有两个 MAJOR。不是 Reject：核心结果已经跑出来，缺陷是补实验和定位能修的。

Top three actions:

1. 补 3 个 seed，报均值±标准差，按 LongBench 子任务拆开；把「不掉」改成「无显著下降」。
2. 加一个 block-sparse 基线（优先 XAttention，代码公开；其次 MInference），同 7B、同 benchmark、同稀疏率；用一句话说清 mean 相对 antidiagonal 的独立优势。
3. 做同稀疏率对照：mean vs random vs antidiagonal，分离「块粒度」和「均值估计」各自的贡献；再补 needle-in-haystack / attention sink 的失败分析。

还有两个点没定，下一轮告诉我能把分数定得更准：31% 是端到端还是只算 attention；块均值是完整 QK 算出来的，还是廉价代理。

### 卡片提醒

- **E05 差距要大过种子间的波动**：71.2 对 70.4 的 0.8 分只跑了一次，先换种子看波动。
- **E02 证据先于叙事**：「准确率不掉」这句话现在撑不住，先补证据再写结论。
- **T01 选题看重要性，也看有没有攻击路径**：这个题重要，但攻击路径要绕过 XAttention，先把这一步写出来。

完整报告在 `.duck/reports/2026-10-25-idea.md`。

> 先查 F1/F3 再打分，是因为这个 idea 的生死不在「省了 31%」，而在 XAttention 已经用 antidiagonal sum 做过同一件事：块重要性评分→跳块；块均值只是换了个统计量（idea-evaluator Step 2；XAttention 2025）。
> **评估一个加速方法，先问它在最强的同类基线面前还剩什么，再问它快多少。**
> 下次先跑 3 个 seed 并补一个 block-sparse 基线，再决定要不要投。
> ▸ 决策：按 workshop 5 天截稿收 scope，先补 3 个 seed 和 XAttention 基线，不扩新模型（AI 定，你可改）

</details>

## review: `/duck-review paper/main.tex` (184s)

- [x] must: read library/pre-submission-reviewer
- [x] must: wrote a review report
- [x] must: caught the single-run claim
- [x] should: caught the em-dash

<details><summary>reply</summary>

## Summary

- CRITICAL: 6
- MAJOR: 17
- MINOR: 6
- Top three fixes first:
  1. 按六段式重搭 Introduction，补三条贡献并各自指到小节，加一个贯穿 Method 和 Experiments 的具体例子。
  2. 补 Related Work 和至少一个 block-sparse 基线（XAttention 或 MInference）；在补上之前删掉「outperforms existing sparse attention methods」，并补 3 个 seed。
  3. 把 Method 写成能复现的样子（定义 attention mass 和 block means，给公式和 V 的去向），补 architecture figure 和参考文献，让引用能解析。

## Dimension 1: Macro logic

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | Introduction 只有背景、一句限制和一个模糊目标：「Large language models are increasingly used on long inputs such as books and code repositories.」→「Prior work utilizes token-level pruning...」→「In this paper, we delve into block-level skipping...」。六段式里的挑战、方法总览、贡献三段都缺 | CRITICAL | 按六段式重写：问题加具体例子；已有方法和两三条限制；问题本质和目标；问题的挑战；方法总览；三条贡献，各指到小节 |
| 2 | 全文没有贡献清单，也没有贡献和小节的对应关系。读者看完不知道这篇论文新在哪：是块均值估计、阈值规则，还是 31% 的加速 | CRITICAL | 在 Introduction 末尾加三条贡献，每条带小节指针，例如「block-mean estimator（Section 2）」「training-free skipping rule（Section 2）」「31% end-to-end speedup on LongBench（Section 3）」 |
| 3 | 摘要说「BlockSkip significantly outperforms existing sparse attention methods」，但 Table 1 只有 Dense attention 和 Token pruning 两行，没有任何 block-sparse 基线（XAttention 2025、MInference 2024、Quest 2024、PBS-Attn 2026） | CRITICAL | 要么在同一 7B/LongBench 设置上补一个 block-sparse 基线，要么删掉这句话，只报实际比较过的对象 |
| 4 | Introduction 只提到「books and code repositories」，没有具体例子，也没有在 Method 和 Experiments 里回访；全文没有 running example | CRITICAL | 加一个具体例子，例如一个 32K token 的代码文件，只有少数块承载检索信号；在 Method 里走一遍，在 Experiments 里做 case study |
| 5 | Method 不自足（原文为 self-contained）：「we estimate the attention mass from the block means」里的 attention mass 和 block means 都没定义，没有公式，也没说 values 怎么处理。按现在的文字无法复现 | CRITICAL | 给出形式定义和公式：块对 (i,j) 的 mass 怎么从 Q、K、V 算，阈值怎么用，哪些块被跳过；加一个三行算法框 |
| 6 | 「BlockSkip \cite{dao2022} builds on block-wise computation.」把 FlashAttention 当成 block-sparse 的前身；而且这句话在 Experiments 里，不在 Related Work | MAJOR | 把定位放进 Related Work；FlashAttention 只在 exact attention 基线或 kernel 处引用；block-sparse 的来历引 XAttention/MInference |
| 7 | 没有 Related Work，全文只有两个引用（prune2023、dao2022），最接近的 block-sparse 工作一篇都没提 | MAJOR | 加 Related Work 或 Introduction 里一段，覆盖 XAttention、MInference、Quest、PBS-Attn 和 token-level pruning，用一句话说清差别 |
| 8 | 「Table~\ref{tab:main} shows that BlockSkip achieves the best accuracy and the largest speedup.」和「which demonstrates that skipping low-mass blocks also removes noise.」只在三行里比，且只跑了一次；best、largest、demonstrates 都超出了证据 | MAJOR | 改成「best among the three compared methods」；补 3 个 seed 和均值±标准差；把 demonstrates 改成 is consistent with |
| 9 | 没有 ablation：1.45x 可能来自 64 token 的块粒度、阈值 τ=1e-3，或均值估计本身；论文把功劳全记在 block skipping 上 | MAJOR | 补 block size（32/64/128）、τ 扫描、同稀疏率下 mean vs random vs antidiagonal，以及估计开销的拆分 |
| 10 | 「Our method is simple, effective and general.」只在一个 7B 模型和一个 benchmark 上测过；全文没有 Limitations | MAJOR | 加 Limitations：一个模型、一个 benchmark、没测 needle-in-haystack、块均值会被单个高权重 token 稀释；把 general 收窄 |

## Dimension 2: Writing details

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | 摘要只有三句：问题、方法、结果。缺「为什么值得做」和「挑战」，结果句只有 31% 时间，没有准确率数字 | MAJOR | 按五句公式重写：问题；为什么；挑战；方法；结果（31% 时间、71.2 对 70.4、7B/LongBench） |
| 2 | 没有段落结构：每一节都是一句一行，Introduction 是一个五句的大段，没有主题句，也没有收束句 | MAJOR | 每段 3 到 8 句，第一句写这一段要说什么，最后一句收束或过渡；一段只讲一件事 |
| 3 | 术语漂移：token-level pruning 和 token-level skipping 混用，block-level skipping 和 block-wise computation 混用，attention blocks 可以指 Transformer 的层块，也可以指 attention 矩阵里的块对 | MAJOR | 一个概念一个词：token-level pruning（前人）、block-pair skipping（本文）、block-sparse attention（这一类）；首次出现时定义 block pair |
| 4 | 「we delve into」「it is a game-changer」是口语和宣传语气，不像技术论文 | MAJOR | 换成 study、show、report；把 game-changer 改成具体的 31% 和 1.45x |
| 5 | 结论只有一句「BlockSkip is a simple and effective method that significantly outperforms prior work.」，重复 Introduction，没有 finding、limitation 和 future work | MAJOR | 用现在完成时总结测到了什么、为什么、一个限制、一个下一步 |
| 6 | 「For each pair of blocks we estimate...」引导短语后面少一个逗号 | MINOR | 改成「For each pair of blocks, we estimate...」 |
| 7 | significantly 在摘要和结论各出现一次，但没有显著性检验 | MINOR | 去掉 significantly，或补检验；outperforms 已经承担了比较 |

## Dimension 3: English grammar

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | 时态不一致（G3）：「Prior work utilizes token-level pruning」用现在时；Experiments 里「We evaluate...」「Table... shows...」「BlockSkip improves...」也用现在时，按 G3 该用过去时 | MAJOR | 「Prior work utilized...」；「We evaluated...」「Table 1 shows...」（表格本身可用现在时，但全节要统一）「BlockSkip improved...」 |
| 2 | 「Large language models are increasingly used on long inputs」的 used on 不地道（G7） | MINOR | 改成 used with long inputs 或 applied to long inputs |
| 3 | 「attention cost grows quadratically」缺冠词（G1） | MINOR | 改成 the attention cost grows 或 attention costs grow |

## Dimension 4: LaTeX format

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | 有 \cite{prune2023} 和 \cite{dao2022}，但没有 \bibliography、\bibliographystyle，paper/ 下也没有 .bib 文件；编译后引用会显示问号 | CRITICAL | 加 references.bib（含两条现有引用和新补的基线），在 \end{document} 前加 \bibliographystyle 和 \bibliography |
| 2 | 两处 \cite 前都没有不换行空格（L1）：「pruning \cite{prune2023}」「BlockSkip \cite{dao2022}」 | MAJOR | 改成 pruning~\cite{prune2023}、BlockSkip~\cite{dao2022} |
| 3 | Table 1 没有横线（没有 \toprule/\midrule/\bottomrule 或 \hline），且用 [h] 放置（L7） | MINOR | 用 booktabs 的 \toprule/\midrule/\bottomrule；放置改成 [t!] |
| 4 | \documentclass{article}，没有目标会议或 workshop 的模板，也没有 page limit；全文没写投哪里 | MAJOR | 定下目标 venue，换对应 style file，按 page limit 检查；如果还没定，先在 cover note 里写清楚 |
| 5 | 表注「Main results on LongBench.」只写了 setup，没写 finding，也没定义 accuracy 和 speedup 的口径（L6） | MAJOR | 改成「BlockSkip matches dense accuracy (71.2 vs 70.4) at 1.45x end-to-end speedup; token pruning gives only 1.04x.」，并在表注里说明 accuracy 是 LongBench 平均分 |
| 6 | 没有节 label，也没有指向 Method 或 Experiments 的 \ref；全文唯一的 \ref 是 Table 1 | MINOR | 加 \label{sec:method}、\label{sec:exp}，在贡献清单里引用 |

## Dimension 5: Figure quality

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | 全文没有图，Method 没有 architecture figure；方法论文至少要一张总览图 | MAJOR | 画一张矢量图：query block、key blocks、block-mean estimator、threshold、skip/keep，标签和正文术语一致 |
| 2 | 没有失败案例或稀疏率与准确率的关系图，唯一的视觉是 Table 1 | MAJOR | 加一张 sparsity 对 accuracy 的图，或一个 needle-in-haystack 的 case study，标出块均值失效的位置 |

## Banned-vocabulary and em-dash scan

- em-dash：line 15 用 em-dash（U+2014）连接两个独立分句。MAJOR。原文：
  ```
  Attention is the bottleneck—its cost grows quadratically with the input length.
  ```
  改成冒号或拆成两句。
- 禁用词表：全文 47 行逐行扫描，没有命中 innovative、pioneering、superior、surpass、remarkable、unprecedented、general-purpose、notably、yet、yielding、encompass、reveal、underscore、pave the way、stems from 等词。
- 另外记两笔，不算禁用词：significantly 出现两次但没有检验；outperforms 出现两次，其中一次没有基线支撑（见 Dimension 1 第 3、8 条）。

## Section-by-section review

| Section | Main gap |
|---|---|
| Abstract | 三句，缺 why 和 challenges；没有准确率数字；outperforms existing sparse attention methods 没有对应证据 |
| Introduction | 五句，没有六段式；没有贡献清单；没有具体例子；没有 Related Work |
| Method | 三句，没有定义和公式；values 没提；没有总览图 |
| Experiments | 一个模型、一个 benchmark、三行结果；没有 setup、seed、ablation、失败分析 |
| Related Work | 整节缺失 |
| Conclusion | 一句，重复 Introduction；没有 finding、limitation、future work |

## Final score (1-10)

2/10

## Submission recommendation

- **Needs major revision before submission**

这份稿子还在搭结构，严格说该先用 /duck-outline 重搭，再 /duck-write 补正文，最后 /duck-polish。现在逐句润色收益很小。

完整报告在 `.duck/reports/2026-10-25-review.md`。

> 这份稿子最贵的问题不是语法，是摘要那句「outperforms existing sparse attention methods」在表里找不到对应行：只有 dense 和 token pruning，XAttention/MInference 都没出现。你 10-25 记下的：评估一个加速方法，先问它在最强的同类基线面前还剩什么，再问它快多少。
> **审稿先看主张和证据的差，不要先改语法；语法改得再顺，撑不住的主张还是会被拒。**
> 下次先列一张「主张→证据→在哪一节」的表，缺证据的主张先删或降级，再动笔润色。
> ▸ 决策：先补结构和基线，暂不做逐句润色；这份稿子按大修处理（AI 定，你可改）

</details>

## propose: `帮我把 paper/main.tex 摘要的第一句改得更紧凑一点。` (40s)

- [x] must: names /duck-polish in the reply
- [x] should: a one-sentence edit adds no notebook line

<details><summary>reply</summary>

改好了。`paper/main.tex` 第 8 行：

```diff
- Long-context inference is slow because attention cost grows quadratically with sequence length.
+ Long-context inference is slow: attention scales quadratically with sequence length.
```

把 `because` 换成冒号，把 `attention cost grows` 缩成 `attention scales`，字数从 12 个降到 10 个。这也顺带消掉了上一轮审稿里 G1 的冠词问题（不再有裸的 `attention cost`）。

如果想再短一点，可以压成「Attention's quadratic cost slows long-context inference.」，7 个词，但主语会从 long-context inference 换成 attention，摘要开头的主线会变。

这只是改一句；整篇要按 Supervisor-Skills 的润色规范走一遍，可以敲 /duck-polish。

</details>

## why: `/duck-why` (87s)

- [x] must: says it is a reconstruction, not a replay
- [x] should: the breakdown is a blockquote
- [x] must: wrote a why report

<details><summary>reply</summary>

拆的是刚才改的摘要第一句（工作区改动，未提交）。

> 用的思路：句子压缩，先保信息再砍虚词。保留「Long-context inference is slow」这个主语和问题，把 because 从句换成冒号，把 cost grows 换成 scales，留下 quadratic 这个量级。
> 为什么：摘要第一句按 section-guides 的五句公式只承担「问题加重要性」，不需要完整背景；G1 要求可数名词带冠词，删掉 attention cost 这个名词短语正好一并解决（pre-submission-reviewer 的 section-guides.md、grammar-rules.md G1）。
> 这次的过程：你点名「摘要第一句、更紧凑一点」，这一步是你定的；具体改成冒号加 scales、保留 with sequence length，是我定的。
> 我提了 7 个词的版本，但没替你选；上一轮审稿还指出摘要只有三句、缺 why 和 challenges，这次没动，回复里也没提醒，这是过程里的遗漏。
> 放弃了什么：更短的「Attention's quadratic cost slows long-context inference」把主语从 long-context inference 换成 attention，摘要开头的主线会偏，所以没选。
> 只补冠词、不改句式的版本能过 G1 但不紧凑，也没选；先重搭摘要结构收益更大，但你要的是局部改一句，这一轮没做。
> （以上根据代码和过程记录重建，不是 AI 内部过程的回放。）
>
> **紧凑不是删信息，是先砍连接词和空动词，保住主语、因果和量级。**
> 要核对的话：合上后半段只读第一句，看还能不能说出「什么慢、为什么慢、增长多快」；三样都在，压缩就没丢信息。再把 7 词版放回同一段，看主语换成 attention 后下一句接得顺不顺。

完整拆解在 `.duck/reports/2026-10-25-why.md`。

</details>

## quiet: `/duck quiet` (25s)

- [x] must: config says quiet

<details><summary>reply</summary>

已经改成 **quiet** 了。

这一档的意思是：决策行、完整报告和笔记本里的内容都照常记录、照常保存，只是不在对话里显示。以后你敲 /duck-xxx，我只交命令本身的结果；「为什么」、决策行和报告都不再放进对话，但会照常写进 `.duck/decisions.md`、`.duck/reports/` 和 `.duck/notebook.md`。平时干活用到的原则也照样记进笔记本。

你专门敲 /duck-why 或 /duck-learn 时，我仍然会在对话里讲。

想切回来说 /duck on，想完全关掉说 /duck off。

</details>

## polish-quiet: `/duck-polish 润色 paper/main.tex 的摘要` (116s)

- [x] must: read library/paper-polish
- [x] must: still wrote a report
- [x] must: no why part in the reply

<details><summary>reply</summary>

已写回 `paper/main.tex`。润色后的摘要：

```
Long-context inference is slow: attention scales quadratically with sequence length.
We propose BlockSkip, which skips query-key block pairs whose estimated attention mass is small.
In our experiments, BlockSkip outperforms dense attention and token pruning while reducing inference time by 31\%.
```

主要改动：

- `attention blocks` 改成 `query-key block pairs`：和方法节的 query/key 分块、逐对跳过对齐，消掉 `attention blocks` 指层块的歧义。
- `estimated contribution` 改成 `estimated attention mass`：用方法节自己的术语。
- 删 `significantly`：论文没有显著性检验。
- `existing sparse attention methods` 改成 `dense attention and token pruning in our experiments`：Table 1 只有这两个基线。
- 第一句上一轮已经压过，这次没动。

需要你确认（动了主张强度，不是纯语言）：

- 原句的比较范围比 Table 1 大。如果手上有 XAttention/MInference 的对比，把更广的说法放回去；没有的话，现在这版才和表对得上。
- 删 `significantly` 是弱化；有多 seed 检验可以加回来。

超出润色的部分（没动）：

- 摘要还缺 why/gap、LongBench/7B 的设置和准确率数字（Table 1 有 71.2 对 70.4）。这些是内容，按润色规则没有替你补；要补可以做一次 deep rewrite，或用 /duck-write 重写摘要。

</details>

## quiet-free: `把 code/skip_attn.py 里跳过块的阈值从固定的 1e-3 改成每一层按块分数的 90% 分位数来定，其他你定，直接改代码。` (145s)

- [x] must: nothing of the duck in the reply
- [x] should: the notebook got one line about this step

<details><summary>reply</summary>

改好了。`code/skip_attn.py` 现在按每层块分数的 90% 分位数来定阈值，不再是固定 `1e-3`。

核心逻辑：

```python
scores = block_scores(q, k)
mask = scores > np.percentile(scores, percentile)
```

主要改动：

- 新增 `block_scores(q, k)`，一次算出这一层所有 (query block, key block) 对的块均值绝对点积，再除以 `sqrt(d)`。
- `block_mask(q, k, percentile=90.0)`：取 `np.percentile(scores, 90)` 当阈值，保留分数高于阈值的块。
- `skip_attention(q, k, v, percentile=90.0)`：把 `percentile` 继续往下传。
- 增加兜底：某个 query block 一个块都没留下时，保留它分数最高的那个 key block，避免整行输出为零。原来 `or [np.arange(0)]` 那个空 mask 时固定取第 0 列的兜底已删掉。

关键语义：90% 分位数配 `>` 是「保留分数最高的约 10%」，不是「保留 90%」。如果你要的是「跳过最低的 10%，保留 90%」，把 `percentile` 改成 `10.0` 就行，代码不用再动。

这个文件一次处理一层（一个 q/k 对），所以「每层一个阈值」就是每次 `block_mask` 调用算一次；如果上层是按 head 调的，那就是每个 head 一个阈值。

验证：`python3 -m py_compile code/skip_attn.py` 通过。环境里没装 numpy，数值测试没跑成；你那边有 numpy 的话，跑一下原来的 `skip_attention(q, k, v)` 就能对。和原来一样，序列长度不是 64 的倍数时，尾部不足一块的部分不参与计算。

改动和决策已记进 `.duck/decisions.md` 和 `.duck/notebook.md`。

</details>

## card-draft: `/duck-skill card new 我们组规定：结果表里每个数都要写明跑了几个随机种子` (34s)

- [x] should: shows the card before writing it

<details><summary>reply</summary>

这是第一张组卡，编号 **G01**（`.duck/cards/` 还没有，按规则从 G01 起）。我打算写两个文件，现在还没动：

`.duck/cards/G01.md`：

```
---
id: G01
title: 表里每个数写明种子数
when: 写结果表、审稿
strength: 你们组
sources: [课题组]
scope: 本组
added: 2026-10-25
---
规矩：结果表里每个数都写明跑了几个随机种子。
为什么：课题组规定，未给具体理由。
```

`.duck/cards/INDEX.md`：

```
# 我们组的卡

| 卡号 | 标题 | 认同程度 | 什么时候用 | 文件 |
|---|---|---|---|---|
| G01 | 表里每个数写明种子数 | 你们组 | 写结果表、审稿 | G01.md |
```

`when` 我按「写结果表、审稿」记；`为什么` 你说的是组里的规定，没给具体理由，我先照实写「课题组规定，未给具体理由」，你有理由再补。

这样写可以吗？点头我就写。以后写结果表、审稿时会按这张卡查：每个数都要有种子数。

</details>

## card-ok: `可以，写吧。` (25s)

- [x] must: wrote .duck/cards/G01.md
- [x] must: INDEX lists G01

<details><summary>reply</summary>

写好了。

- `.duck/cards/G01.md`：规矩、使用场景、出处都记上了。
- `.duck/cards/INDEX.md`：建了组卡目录，G01 已入表。

以后写结果表、审稿时会按 G01 查：每个数都要写明跑了几个随机种子。想静音这张卡，敲 `/duck-skill card off G01`。

</details>

## learn-ask: `/duck-learn` (17s)

- [x] must: opens with the one question

<details><summary>reply</summary>

先说一句：这次哪一步是你自己定的，哪一步最想重来？不想说可以跳过。

</details>

## learn: `补 seed 是我定的。最想重来的是摸方向，搜得太窄了。` (98s)

- [x] must: wrote a learn report
- [x] should: lists what was left to the AI
- [x] should: next step uses the answer

<details><summary>reply</summary>

**本来想干什么**
最早记下的是 10-02：「长文本推理时，注意力里很多块几乎是零，可以整块跳过。」后来定成 7B/LongBench 省 30% 以上时间、准确率不掉，投 workshop，截稿 10-30。

**实际怎样**
token 级只省 4%；64 token 块省 31%，71.2 对 70.4，只跑了一次。10-25 审稿：6 CRITICAL、17 MAJOR、6 MINOR，2/10，大修。摘要已按实际基线收窄，skip_attn.py 的阈值改成每层 90% 分位数，py_compile 通过但没跑数值测试（环境没 numpy）。这一段没有新提交，两个文件还在工作区。

**顶级导师会盯哪里**
1. 摸方向窄，连带定位和结构都没搭起来：XAttention 2025、MInference 2024、Quest 2024、PBS-Attn 2026 这条 block-sparse 线没进检索，也没进 Related Work；47 行的稿子没有 Related Work、参考文献和图。定位没做完，novelty 和 baseline 都悬空（T01；idea-evaluator F1/F3；pre-submission-reviewer 的 severity taxonomy）。
2. 证据强度：71.2 对 70.4 只跑了一次，0.8 分没和种子波动比过，结论却写成「不掉」；G01 现在要求每个数写种子数（E05；G01；NeurIPS 投稿清单第 7 项）。

**这次交给 AI 的判断**
- 5 天 scope、加 XAttention 基线、不扩新模型；补 seed 是你定的，决策行已按你的说法改过来。
- 先补结构和基线、暂不逐句润色，按大修处理。
- 摘要收窄比较范围、删 significantly。
- skip_attn.py 取字面 90% 分位数、保留前 10%、每行留最高分块。

下次想自己定，说一声就行。

**下一步**
1. 先补摸方向：用 /duck-survey 按 block-sparse attention、long-context prefill、training-free sparse attention 三组词搜，列 5 篇最近的，写一张「谁做过什么 / 差在哪 / 我们的位置」的表。这张表出来之前，先别再补 seed 或改模型。
2. 表出来再定基线：3 个 seed + 一个 block-sparse 基线，每个数带种子数（G01）；如果 mean vs antidiagonal 这条轴太薄，就决定改 claim 还是缩 scope。5 天不够就投短稿或延 deadline，别带着 6 个 CRITICAL 投。

完整复盘在 `.duck/reports/2026-10-25-learn.md`；两条原则已进 `.duck/notebook.md`。

</details>

## off: `/duck off` (23s)

- [x] must: config says off

<details><summary>reply</summary>

改好了，现在是 **off**。

这一档的意思是：常驻规则不再加载。平时干活不再自动讲「为什么」、记决策行、写报告和笔记；`/duck-xxx` 命令照样能用，只是不附这些记录。你自己要求的改动（比如改代码、润色、建卡）照做。`/duck-why`、`/duck-learn` 你专门敲的时候照常讲。

之前的 `.duck/` 记录都还在，不会被删，只是不再自动新增。

想再开：`/duck on` 恢复完整模式，`/duck quiet` 只记不说。

</details>

## off-new-session: `/duck-polish 润色 paper/main.tex 的结论一节` (125s)

- [x] must: hook injected the off note
- [x] must: no new report
- [x] must: notebook untouched

<details><summary>reply</summary>

已改在 `paper/main.tex` 第 45 行。

**润色后：**

```latex
BlockSkip is a simple and effective method that outperforms dense attention and token pruning in our experiments.
```

**主要改动**

- 删掉 `significantly`：论文没有报告显著性检验，保留这个词会暗示做过统计检验。
- `prior work` 收窄为 `dense attention and token pruning in our experiments`：Table 1 只有这两个基线，原句的比较范围比证据大。
- 句式结构和 `simple and effective` 保留，没有改动段落结构。

**需要你确认的改动（可能涉及科学含义）**

| 原句 | 改后 | 为什么 | 风险 |
|---|---|---|---|
| `... significantly outperforms prior work.` | `... outperforms dense attention and token pruning in our experiments.` | 目前只和这两个基线比过，也没有显著性检验 | 收窄了比较范围，也弱化了主张；如果你还有更多基线或检验结果，可以相应放回 |

**结论还缺一层（属于内容问题，不是语言问题）**

现在这句只说了“方法简单有效、比基线好”，没有回答结论节该回答的两件事：决定性发现是什么（0.8 个百分点、31% / 1.45×），结论的边界在哪（LongBench、7B）。这是内容缺口，靠润色句子补不上，我也没有替你加数字。

如果要补，可以用下面这版；数字都来自论文现有内容，没有新造，确认后再放进正文：

```latex
BlockSkip skips query-key block pairs whose estimated attention mass is small. On LongBench with a 7B model, it improves accuracy by 0.8 points over dense attention and reduces inference time by 31\%, while also outperforming token pruning on both accuracy and speed. These results indicate that block-level skipping can make long-context inference faster without sacrificing accuracy.
```

如果想把结论整体重写，建议走 `/duck-write` 重写这一节，然后再回来润色。

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
