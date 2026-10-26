# e2e dsh 0.2.1-rc.2 main 0c55aa8, Doctor Duck 345d618 ((profile default))

13/13 checks passed; must failed 0, should failed 0

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":53258,"outputTokens":32484,"cacheReadTokens":942336,"cacheWriteTokens":0,"totalTokens":1028078}

## enable: `/duck on` (17s)

- [x] must: config says on
- [x] must: read the resident rules this turn, or the context brought them

<details><summary>reply</summary>

Quack！开关已切换到 **on**。

已新建 `.duck/config.md`（之前这个项目没有 `.duck/`），里面写的是：

```
开关：on
```

这一档的意思是：平时正常完成工作时也按常驻规则来。

- **讲为什么**：完成一步实质工作后，在回复末尾附一条一两行的说明，讲这一步的关键取舍和依据；能提炼成原则的，就整行加粗。
- **记决策**：有取舍时记一行「▸ 决策：选了 A、放弃 B、谁定的」，同时追加到 `.duck/decisions.md`。
- **结果进论文前对标准**：写进表、写进论文、写成结论之前，先检查三件事（只跑一次、提升没拆来源、结论强过证据），撞上了先提醒你再动手。
- **只提议不自动跑**：事情归某条命令管（润色、审稿、写引言等）时，我会点出那条命令问你要不要走。
- **命令跑完出「为什么」报告**：短版放对话里，完整版存进 `.duck/reports/`。
- **记笔记本**：值得带走的原则记进 `.duck/notebook.md`（`/duck-notes` 可以随时看、改）。

说「这类我懂了」，我就在 `.duck/config.md` 的「按类静音」下记一行，以后这类只记不讲。要改成只记不说，敲 `/duck quiet`；要关掉，敲 `/duck off`。

从这一轮起就按 on 走。

</details>

## idea: `/duck-idea 我想做长文本推理加速：用块均值估计注意力里每一对 64 token 的块贡献多大，贡献很小的整块跳过。目标是 7B 模型在 LongBench 上省 30% 以上时间、准确率不掉。对手是 token 级剪枝和稠密注意力。现有结果在 notes.md 里。` (271s)

- [x] must: read library/idea-evaluator
- [x] must: wrote an idea report
- [x] must: notebook got a line
- [x] should: reply has the why block

<details><summary>reply</summary>

按 `/duck-idea` 处理。

### 1. First impression

- Paper type: Novel Method（增量式效率方法）
- One-sentence story: 用块均值给每个 64-token 键块估一个分数，低于阈值就整块跳过，在不训练的情况下把 7B 模型的长上下文推理时间降下来。

### 2. Fatal-flaws audit（early gate）

| # | Flaw | Severity | Defense |
|---|---|---|---|
| 1 | **F1 新意不足**。block-sparse 这条线 2024 年就有 [MInference](https://arxiv.org/abs/2407.02490)（NeurIPS 2024）、[Quest](https://arxiv.org/abs/2406.10774)（ICML 2024）、[SparQ](https://arxiv.org/abs/2312.04985)（ICML 2024）；2026 年 [BSFA](https://neurips.cc/virtual/2026/loc/sydney/poster/155122)（NeurIPS 2026）几乎同题：按块分数选 top-k、按校准阈值跳块、8B 模型 LongBench 1.13x、对五个稀疏基线。你的差异只剩「用块均值而不是 max / min-max bound 估分」，这一点既没论证也没实验。 | MAJOR | 把差异做成主张：选块本身要不要先算 score。给 mean / max / min-max bound / random 四种估计器，在相同跳过率下比精度、选块 FLOPs、端到端时间，证明「更便宜的估计器够用」。 |
| 2 | **F3 基线不是真基线**。表里只有 dense 和自写的 token pruning，没有任何已发表的 block-sparse 方法；摘要里「significantly outperforms existing sparse attention methods」没有对应实验。 | MAJOR | 至少加 MInference、Quest、SparQ（都有公开代码），引用 BSFA；在相同跳过率下比，不只比各自默认设置。 |

两个 MAJOR，按 `fatal-flaws.md` 第 5 节走 Accept with Revisions，先补这两处再谈投稿。

### 3. Lifecycle and capability match

| Aspect | User's input | Assessment |
|---|---|---|
| Idea category | 训练-free 的推理加速方法 | Application research |
| Lifecycle | 3-6 个月 | 与 10-30 workshop（4 天）严重不匹配 |
| Weekly effective hours | 未声明 | 待补，按 20 小时左右估 |
| Fit | 方向可行，4 天内只能交缩水版 | Yellow |

### 4. Five-dimension radar

| Dimension | Score 1-10 | Evidence | Lift suggestion |
|---|---|---|---|
| Higher | 5 | 71.2 vs 70.4，单次；+0.8 在种子波动内，「跳块去噪」没有机制支持，代码里还有缺 causal mask 的风险。 | 不把 accuracy 当卖点，先把 parity 做扎实。 |
| Faster | 7 | 省 31%（1.45x），单次测量；块级跳过能同时省计算和 KV 读取，token 级只省 4% 也符合文献。但没有拆 attention-only 和 end-to-end。 | 用带 kernel 的实现测端到端，做到 1.5x 以上。 |
| Stronger | 4 | 单模型、单 benchmark；块均值在 query 方向分散时会互相抵消，固定 τ 不随层和头校准。 | 加长度扫描、第二个模型、per-head 阈值。 |
| Cheaper | 7 | training-free、无标注；选块只需块均值（每块 O(d)），比 BSFA 先算全量 score 更便宜。 | 把选块成本量化成 FLOPs 和延迟，做成第二张主表。 |
| Broader | 4 | 只在 7B decoder 和 LongBench 上验证。 | 换模型族或任务类型，或写清适用边界。 |

最高两项：Faster 7、Cheaper 7。主线应该是「更便宜的选择 + 真实的加速」，不是「更准」。

### 5. Paradigm-shift probe

| Probe | Yes or No | Rationale |
|---|---|---|
| First Principles | Partial | 隐含挑战了「必须先算 score 才能决定跳哪块」；现稿没把这句话写出来。 |
| Elephant in the Room | No | 算法稀疏和实际 wall-clock 的差距是老问题，block-sparse 已在解决。 |
| Technology Cycle | No | 块稀疏注意力几年前就能做。 |
| Hamming's Rule | No | 解决后是 30% 加速，有用，但不改变领域的优先级。 |

Disruptive potential: none。纯增量，把 Faster 和 Cheaper 作为主线，不要包装成范式转变。

### 6. Feasibility

| Risk | Level | Mitigation |
|---|---|---|
| Compute | Medium | 7B 加 LongBench 单卡可跑；31% 端到端要有 kernel，numpy 原型不算。先用 PyTorch 或 Triton 做 attention-only 计时，再决定接不接现成 block-sparse kernel。 |
| Data | Low | [LongBench](https://arxiv.org/abs/2308.14508) 公开，[RULER](https://arxiv.org/abs/2404.06654) 也可加。 |
| Engineering | High | 仓库里是 numpy 实现，没有 causal mask，没有全跳过时的回退；能打的 kernel 是主要工作量。用 Triton 或 FlashAttention 的 block-sparse 接口，不要从零写 CUDA。 |
| Timeline | High | workshop 10-30，只剩 4 天；补基线、3 个 seed、kernel 现实要 2-4 周。要么交 4 页缩水版（估计器研究 + attention-only 计时），要么放弃这次 deadline。 |

每周有效小时数和卡数没给，timeline 按「1-2 张 A100」估；补这两个数可以算准。

### 7. Verdict

**Accept with Revisions**（worth pursuing, pending the validation experiment）

Top three actions to take first:

1. **先修有效性**：补 causal mask，补全跳过时的回退（至少保留对角块或估分最高的块），用 3 个 seed 重跑 71.2，确认不是未来 token 漏进来的结果。
2. **把主张改成「选块成本 vs 选块质量」**：mean / max / min-max bound / random 四种估计器，在相同跳过率下比 accuracy、选块 FLOPs、attention-only 与 end-to-end 时间。这是相对上面那四篇唯一站得住的差异轴。
3. **加真基线并改口径**：MInference、Quest、SparQ，引用 BSFA；删掉「significantly outperforms」和「skipping removes noise」。4 天不够就交 4 页 workshop 版，或跳过这次 deadline。

### 卡片提醒

- **E05 差距要大过种子间的波动**：71.2 vs 70.4 只跑了一次，0.8 分先和 seed 波动比。
- **E02 证据先于叙事**：「跳块去噪所以更准」和「significantly outperforms」都跑在证据前面。
- **X02 基线要和自己的方法下同样的调参功夫**：token pruning 是自己写的 4% 版本，不是已发表 SOTA 基线。

完整报告存进 `.duck/reports/2026-10-26-idea.md`，笔记本记了一条，方向背景写进 `.duck/background.md`（鸭子页签能看到）。

> 先说这次为什么这么判：F1 要查的是真对手，不是你自己列的对手。你说对手是 token 剪枝和稠密注意力，但 2026 年这条线的标尺是 BSFA（NeurIPS 2026）、MInference、Quest、SparQ，漏了它们，31% 就没有参照（fatal-flaws.md F1/F3）。
> **评估一个新方法，先把同一方向上最强的三条基线找出来，再谈自己快了多少。**
> 下次先做三件事：把 31% 拆成 attention-only 和 end-to-end，给 71.2 补三个 seed，确认跑分用的是不是带 causal mask 的那份代码。
> ▸ 决策：判 Accept with Revisions，砍掉 SOTA 主张，先补有效性和 block-sparse 基线再投（AI 定）

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
