# e2e dsh 0.2.1-rc.2 loop c4d0f11, Doctor Duck 345d618 ((profile default))

21/21 checks passed; must failed 0, should failed 0

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":46104,"outputTokens":70664,"cacheReadTokens":2123264,"cacheWriteTokens":0,"totalTokens":2240032}

## route: `/duck 帮我看看摘要最后一句是不是说得太满了` (123s)

- [x] must: names the command it picked
- [x] must: read the picked skill
- [x] should: brings up the 10-09 notebook entry

<details><summary>reply</summary>

是，说得太满。我按润色流程处理 `/duck-polish`。

建议先改成：

```
On LongBench with a 7B model, BlockSkip reaches 71.2 accuracy, compared with 70.4 for dense attention and 69.1 for token pruning, while reducing inference time by 31% in our experiments.
```

这句话只报这次测到的数，不替读者下「比现有方法都强」的结论。

三处问题：

1. **`significantly` 没有检验撑着。** `notes.md` 10-06 写着只跑了一次，表里也没有误差棒或显著性检验。审稿人看到这个词会默认你在说统计上显著；71.2 对 dense 的 70.4 只差 0.8 分，单次运行分不清是方法有效，还是随机种子碰巧带来这个差距。
2. **`existing sparse attention methods` 是复数全称。** 表里只有一个基线 Token pruning（69.1），实验只有一个数据集 LongBench、一个 7B 模型。你们引言自己把 token pruning 写成 token-level pruning，它也不等于「稀疏注意力方法」这一整类。这个概括范围比数据支撑的大。
3. **31% 本身没问题。** 1.45 倍加速就是 `1 - 1/1.45 = 31.0%`，和表对得上；但摘要没写测速条件（序列长度、硬件、batch size），建议带上「在我们的实验里」这个边界。

两条路，选一条：

- **补证据**：主结果至少换 3 个种子重跑，报均值±标准差，或者做显著性检验。差距扛得住，`significantly` 可以留，但 `existing methods` 还是要收窄到实际比过的那几个基线。
- **降成观测**：用上面那句，让数字自己说话，把「方法更好」留到补完种子再说。

我先没动 `main.tex`。把结论改弱属于改科学含义，按润色规范要你点头。你要 **A** 先改成上面这句，还是 **B** 先补种子再定？

顺带：结论段第 45 行「significantly outperforms prior work」和正文第 42 行「demonstrates ... removes noise」是同一个毛病，等说法定了可以一起改。完整报告存在 `.duck/reports/2026-10-25-polish.md`。

**卡片提醒**
- **E02 证据先于叙事**：写结论前先试着推翻它，撑不住的那一句就是审稿人的靶子。
- **E05 差距要大过种子间的波动**：只跑一次的提升，可能只是随机种子的运气。

> 这一步没有直接改文件：改弱结论就是改科学含义，润色规范要求先确认；但也不能留着 `significantly`，notes 只跑了一次，没有种子波动接得住（W11；你 10-09 记下的同一条）。
> `existing sparse attention methods` 同理：表里只有一个基线、一个数据集，推不出复数全称（E05、E02）。
> **比较级的每一个词，都要能指回表里的一行和一次能重复的实验。**
> 下次先翻 notes 看跑了几次、表里有几个基线，再决定摘要里用 outperform 还是直接报数。

</details>

## intro: `/duck-intro 按 paper/main.tex 的内容重写引言。先在对话里给草稿，paper/ 里的文件先别改。` (232s)

- [x] must: read library/intro-drafter
- [x] must: brings up the 10-12 notebook entry
- [x] must: notebook has no repeated principle
- [x] should: paper/main.tex untouched

<details><summary>reply</summary>

下面是引言草稿，`paper/` 里的文件没有改动。

```latex
Long-context inference is slow because attention cost grows quadratically with sequence length. Large language models are increasingly applied to inputs that span books and code repositories, and in these settings attention becomes the bottleneck. Reducing the number of attended tokens is therefore a direct way to reduce latency. The difficulty is that removing token-level interactions does not necessarily remove work at the granularity the hardware executes: a method can attend to fewer tokens and still spend nearly the same wall-clock time. This gap between algorithmic sparsity and realized speedup is the starting point of our study.

Prior work has approached this problem by pruning at the token level \cite{prune2023}. Token-level pruning reduces the number of tokens that attention considers, and it can lower the theoretical amount of attention computation. In practice, the reduction in attended tokens does not translate proportionally into wall-clock savings: in our experiments, token-level pruning reduced inference time by only about 4\%. Block-wise computation \cite{dao2022} provides an efficient substrate for dense attention, but an efficient substrate is not a rule for deciding which blocks can be omitted. What is missing is a cheap, input-dependent skip rule at the granularity at which the computation is already organized.

The problem is therefore one of granularity and cost. Attention is quadratic in the input length, and any method that first computes the full attention matrix to decide what to skip has already paid the cost it hopes to avoid. Our goal is to reduce long-context inference time at run time, without retraining the model or changing its weights, by deciding which block pairs are worth computing before the full attention matrix is formed. The key idea is to estimate each block pair's contribution from block-level statistics and to skip pairs whose estimated contribution is below a threshold.

Three obstacles stand in the way. First, the importance of a block pair must be estimated cheaply: an exact estimate requires the attention scores that the method is trying to avoid, so the estimator must operate on a coarser representation. Second, the skip decision must be stable across inputs: a threshold that is too aggressive removes useful interactions, while one that is too conservative leaves the computation unchanged. Third, the resulting skip pattern must translate into wall-clock savings: if the remaining computation is scattered across blocks, it may not map efficiently to block-level kernels. These challenges are coupled; a cheap estimator is useless if its decisions cannot be executed efficiently.

We propose BlockSkip, a training-free attention routine that addresses these challenges with three components. To estimate block importance cheaply, BlockSkip summarizes each block by its mean query and mean key and scores a block pair by the scaled dot product of those means; this reduces the scoring cost from token pairs to block pairs. To make the skip decision, it compares the estimated score against a threshold $\tau$ and omits the pair when the score falls below $\tau$; we use $\tau = 10^{-3}$ in all experiments. To keep the remaining computation block-structured, the mask is applied to 64-token blocks, so skipped pairs are removed at the same granularity as the underlying block computation. The three components map to the three challenges: the block-mean estimator makes the decision cheap, the per-input score makes it input-dependent, and the block-level mask makes it executable. Section 3 describes the full procedure.

We summarize our contributions as follows. First, we propose BlockSkip, a training-free attention routine that estimates block-pair importance from block means and skips low-mass pairs at inference time (Section 3). Second, we design a thresholded block-skip mask that operates on 64-token blocks and keeps the remaining computation block-structured (Section 3). Third, we evaluate BlockSkip on LongBench with a 7B model: in our single-run experiments it reaches 71.2 accuracy, compared with 70.4 for dense attention and 69.1 for token pruning, while reducing inference time by 31\% (1.45$\times$ speedup) (Section 4).
```

要你补的三处：第 1 段还没有真实的 running example，给我一个实验或部署里的具体案例；参考文献表还没建，正文只保留了你原稿的 `prune2023` 和 `dao2022`；我把方法写成 training-free，确认一下确实不涉及微调。31% 和 71.2 是按单次观测写的，没有写 significantly。

这是 AI 写的引言，事实、数字和引用请你逐条核对。

**卡片提醒**
- **W01 先把贡献写成一到三条**：三条就够，每条指回一节。
- **E02 证据先于叙事**：贡献里的每个数字都要有实验接着，撑不住的那句就是审稿人的靶子。
- **E05 差距要大过种子间的波动**：单次运行的 71.2 对 70.4 只能算观测，不能算显著更好。

> 这次按方法论文搭骨架：问题已经存在，重量放在方法和三个挑战上，第三段只做短桥（intro-drafter 的 paper-types）。
> 背景段没有编 running example，因为 running-example 的第一条就是例子必须真实；挑战段按你 10-12 记下的写法，从问题本身长出来，不写「实现起来难」（W09）。
> **没有真实例子时，宁可把背景段写短，也不编一个场景把它撑满。**
> 下次先给我一个真实的长文档案例，再决定摘要和引言里哪些数字可以写成结论。
> ▸ 决策：按方法论文定位，第三段只做桥，不把 block-level skipping 包装成新问题（AI 定）；不编 running example（AI 定）；不新增引用，只保留原稿的 prune2023 和 dao2022（AI 定）

</details>

## exp: `新结果出来了：32k 长度上 BlockSkip 准确率 70.9，稠密注意力 70.6，只跑了一次。帮我把这一行加进 paper/main.tex 的表里。` (40s)

- [x] must: raises seeds or run-to-run variation
- [x] should: asks before editing the table

<details><summary>reply</summary>

先别急着改，这一行直接触发了 E05 的检查条件。32k 上 70.9 对 70.6，只差 0.3 分，而且只跑了一次；0.3 分很可能落在种子间波动里，直接放进主表会让读者以为 BlockSkip 在 32k 上更好。R02 没有触发（0.3 分不算大提升），E02 暂时也没有触发（你现在只是加表，还没写结论）。

改之前有三件事要定：

1. 先补至少 3 个种子重跑、报均值±标准差，还是先按 single-run（单次运行）观测加、并在表注里写明只跑了一次？算力不够的话，写明理由也可以，但不能让读者以为是稳定提升。
2. 现有表里的 70.4 和 71.2 是哪个长度？32k 这组还是同一个 7B 模型和 LongBench 吗？如果长度不同，32k 这组要加 Length 列、单独一张表，还是替换现有行？
3. 32k 的 speedup 测了吗？表里有 Speedup 列，没有的话这格只能留 `--` 或空着。

等你确定这三件事后，我再修改 `paper/main.tex`。

</details>

## exp-ok: `先补到 3 个 seed，表等结果出来再改。` (52s)

- [x] must: a new decision line says the student decided
- [x] should: reply shows the decision line

<details><summary>reply</summary>

好的，`paper/main.tex` 先不动，按 E05 把 3 个 seed 补齐。补的时候保持同一套 32k、7B、LongBench 设置，BlockSkip 和 dense 各跑 3 次，记录均值和标准差；如果也测了加速比，就把 speedup 一并记录下来。结果出来后，再看 0.3 分是否超过种子波动范围，然后决定表怎么放（是加 Length 列，还是单独一张表），以及 Speedup 列怎么填。

> 只跑一次时，仅凭 0.3 分分不清它来自方法本身还是随机种子波动，因此先补到 3 个 seed，再写入表格，这样主表就不会因为一次运气而偏离真实结果（E05）。
> **在差距大过种子波动之前，主表先空着，暂不填入这一行。**
> 下次先把 seed 数和波动写进表注，再决定这一行放进主表哪里。
> ▸ 决策：32k 的 70.9/70.6 先补到 3 个 seed，主表暂不改，等均值±标准差出来再定（你定）

</details>

## mute: `多 seed 和方差这类我懂了，以后别讲了。` (25s)

- [x] must: config mutes the category

<details><summary>reply</summary>

记下了。以后多 seed 和方差这类，只记决策和笔记，不在对话里讲。

</details>

## mute-check: `64k 长度上也出来了：BlockSkip 69.8，稠密 69.9，也只跑了一次。先记进 notes.md，表等补完 seed 再说。` (40s)

- [x] should: notes.md got the 64k result
- [x] should: does not explain seeds again

<details><summary>reply</summary>

记好了：32k 和 64k 两条都写进了 `notes.md`，`paper/main.tex` 没有改动，表等补齐种子后再改。

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
