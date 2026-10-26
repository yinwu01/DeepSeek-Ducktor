# e2e dsh 0.2.1-rc.2 more 0c55aa8, Doctor Duck 345d618 ((profile default))

14/14 checks passed; must failed 0, should failed 0

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":114805,"outputTokens":100839,"cacheReadTokens":10400896,"cacheWriteTokens":0,"totalTokens":10616540}

## survey: `/duck-survey 块稀疏注意力用于长文本推理加速。范围小一点：只看 2023 年以后，十篇以内，研究问题你来定两个。` (1082s)

- [x] must: read library/deep-research
- [x] must: wrote a survey report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number
- [x] must: not turned on: hook injected the idle note
- [x] should: cites checkable sources
- [x] should: wrote .duck/background.md with links

<details><summary>reply</summary>

按你的范围做的：2024 到 2026 年（2023 年以后），10 篇，9 篇方法加 1 篇评测基准。两个 RQ 我定成：选择开销如何解释「算法省下的算力」到「端到端省下的时间」之间的折扣；平均分上的精度持平又掩盖了哪些失败。

---

# 块稀疏注意力用于长文本推理：选块策略已转向，选择开销与跨块证据仍是瓶颈

## Abstract

长上下文推理的瓶颈已经从「能不能注意」变成「值不值得注意」。2024 年以来，block-sparse attention 把 KV cache 切成块，只计算被判定为重要的块，报告了 6 到 28 倍不等的加速。本文不按模型结构罗列方法，而是按「块重要性信号在哪里产生」把 9 篇方法分成离线图案、在线统计、学习 indexer 三支，并用 RULER 作为精度证据的标尺。两个研究问题分别是：选择开销如何解释从 FLOPs 节省到 wall-clock 加速的折扣；平均分上的精度持平掩盖了哪些失败。核心判断是：选块策略的重心已经从固定图案移到在线统计与学习 indexer，但常规 block selection 仍是新的二次项；在报告了同一口径的几个方法里，算法节省到端到端加速打了 2 到 5 折；现有证据里的精度持平，多是在方法自选的稀疏率和检索型任务上取得的，高稀疏、128K 以上、以及需要跨块聚合的任务更容易失守。

## 1. Introduction

2024 年，MInference 报告 1M token 的 prefill 延迟最多降到十分之一 [1]；2025 年，MoBA 报告 1M prefill 的 attention 计算快 6.5 倍 [2]；2026 年，MSA 报告 1M 上下文上 14.2 倍 prefill、7.6 倍 decode 的 wall-clock 加速 [3]。三个数字都指向同一件事：块稀疏已经能把长上下文的注意力成本压下来。但把这三个数字放进同一张表就会失真，因为 MInference 量的是 prefill 端到端延迟，MoBA 量的是 attention 计算时间，MSA 量的是端到端 wall-clock，baseline 与硬件也不同。

更麻烦的是，这三篇都没有把「选块本身花了多少时间」单独列成一行。Block-sparse 的计算量随选中块数线性增长，但选块要扫多少块，决定了它能不能在 decode 的每一步里活下来。PISA 把这件事说得很直接：选中块之后的 attention 是线性的，但为每个 query 给所有 key block 打分，整体仍是 O(N²/C) [4]。选择阶段没有消失，它只是从 attention 矩阵里搬到了 attention 之前。结果是两个常见误读：把不同口径的加速比放在一张表里排名，把 1M 的加速当成 1M 的精度。

这篇综述因此不按模型结构分类，而按「块重要性信号在哪里产生」分类。信号放在离线，选择开销在部署前付掉；放在运行时，选择开销跟着每次 forward 走；放在训练里，选择开销变成数据和算力，换更高的稀疏率上限。信号的位置决定了加速比在哪个环节被折扣，也决定了精度证据该看哪一类任务。

**RQ1**：2024 年以来，block-sparse 方法把「哪些块值得算」的判断放在离线图案、在线统计还是可学习 indexer 上？这三种放置方式的选择开销，如何解释从理论 FLOPs 节省到端到端 wall-clock 加速之间的折扣？

**RQ2**：在现有证据下，block-sparse 在哪些任务和稀疏率上能保持 dense 精度？平均分上的「持平」在什么条件下会掩盖真实失败？

第 2 节交代检索与纳入标准；第 3 节给出分类；第 4 到 6 节分别写三支；第 7 节单独审精度证据；第 8 节做跨支比较；第 9 节列开放问题；第 10 节逐条回答两个 RQ。

## 2. Methodology

检索在 2026-10-26 进行，来源是 arXiv API、ACL Anthology、PMLR、NeurIPS proceedings 与 Semantic Scholar。检索视角分四组，串行执行：主流训练派（native sparse attention、mixture of block attention、trainable block sparsity）；训练-free 推理派（query-aware KV page selection、block-level memory、dynamic sparse prefill）；系统与粒度派（adaptive block size、hierarchical block selection、block-sparse kernel）；评测派（long-context benchmark、multi-hop 与 aggregation 任务）。

关键词组包括 `block sparse attention`、`block-sparse attention`、`KV cache block selection`、`long-context inference`、`native sparse attention`、`mixture of block attention`、`adaptive block size sparse attention`。第一轮按核心词抓 2024 年以后的论文，第二轮从已找到论文的 related work 与引用链补漏，第三轮做最近一年检查。

纳入标准：对象是 LLM 长上下文推理；稀疏单位是 block 或 page，不是单个 token；至少报告一项定量效率或精度结果；2024 年 1 月以后公开。排除标准：token 级 KV eviction、线性注意力与状态空间模型、纯 KV 量化或压缩、只面向视觉或视频生成的 block-sparse 工作。最终语料 10 篇，其中 9 篇方法、1 篇评测基准。把 RULER 计入十篇，是因为 RQ2 需要一把独立的尺子；如果只数方法，语料是 9 篇。按发表状态分，7 篇经过同行评审（MInference、Quest、InfLLM、SeerAttention、NSA、MoBA、RULER），3 篇是 preprint 或技术报告（MSA、AB-Sparse、PISA）。

分类轴选「选择信号在哪里产生」，而不是「训练-free 还是 trainable」，原因是后者会把 PISA 这种「选择器不学习、但 backbone 用稀疏模式预训练」的工作放错位置。按信号位置分，选择开销落在离线、运行时或训练三处，正好对应 RQ1 要解释的折扣。

能力降级说明：检索视角是串行跑的，没有并行 sub-agent；引用与数字另做了一轮独立审计，但所有加速比仍是作者报告值，本文没有复跑。覆盖限制：十篇的硬上限意味着把上下文分片到多机的两阶段 block-sparse 方案没有进入语料；它的稀疏来自 host 分片，不是块选择，和本文的分类轴不同。

## 3. Taxonomy

分类轴是「块重要性信号在哪里产生」。三支分别是：

1. **离线图案**：信号来自部署前的 profile，推理时只建索引，不重新判断哪些块重要。代表是 MInference [1]。
2. **在线统计**：信号来自运行时对块摘要的打分，选择器本身没有学习参数。代表是 Quest [5]、InfLLM [6]、AB-Sparse [7]、PISA [4]。
3. **学习 indexer**：信号来自训练过的 gate、压缩网络或 index branch。代表是 SeerAttention [8]、NSA [9]、MoBA [2]、MSA [3]。

| 信号来源 | prefill | decode | 两阶段都覆盖 |
|---|---|---|---|
| 离线图案 | MInference | 空 | 空 |
| 在线统计 | 空 | Quest、InfLLM、AB-Sparse | PISA |
| 学习 indexer | SeerAttention | 空 | NSA、MoBA、MSA |

表的结论：语料里没有「只针对 decode 的离线图案」，也没有「只针对 decode 的学习 indexer」，在线统计则没有只做 prefill 的方案。空单元格是语料级的空位，不是整个领域的空位；它说明现有工作更愿意把学习成本放在 prefill 或两阶段，而不是单独优化 decode 的选择器。

这张表也暴露了跨支工作。MInference 的图案是离线选的，但稀疏索引是运行时按输入建的，它站在离线与在线之间。AB-Sparse 的块大小是离线校准的，块打分是运行时算的，它也跨两支。NSA 的压缩路径是学出来的，但选择仍是 top-k 打分，站在在线与学习之间。MoBA 的 block 摘要用 mean pooling，路由 gate 是学的，同样跨两支。真正决定成本的是「哪一部分被学习了」，而不是「整个方法算不算 learning-based」。

## 4. 离线图案：把选择成本压到零，但只能选一次

MInference 是这一支的唯一代表，也是理解后面所有方法成本的基线。它先在离线阶段为每个 attention head 选一种稀疏图案：A-shape、Vertical-Slash 或 Block-Sparse；推理时按图案动态建稀疏索引，再用自定义 GPU kernel 只算索引覆盖的位置。Block-Sparse 图案用 64×64 的块，Vertical-Slash 用 1×64 的条带 [1]。这个设计的核心取舍是：把「哪些块重要」的判断提前到部署前，推理时不再为每个 query 打分，选择开销接近零。与 Quest 的在线 page 打分相比，MInference 把打分换成了离线图案选择，在线只剩索引构建 [1][5]。

代价是图案只能选一次。MInference 在 1M 上下文、单张 A100 上报告最多 10 倍 prefill 加速，但在 100K 只有 1.8 倍，300K 是 4.1 倍，500K 是 6.8 倍 [1]。加速随长度增长，是因为 dense attention 的二次项在长上下文才占主导；在 100K 这个很多长上下文应用的真实长度上，块稀疏的收益远没有 headline 那么大。这个长度曲线比 10 倍这个数字更有用：它告诉你方法在哪个区间开始划算，也解释了为什么 Quest 在 32K 就能报 7.03 倍 attention、2.23 倍端到端 [5]，而 MInference 的 10 倍要到 1M 才出现 [1]。

精度上，MInference 在 InfiniteBench、RULER、PG19 与 NIAH 上报告与 dense 持平或略好，但在 LLaMA-3-8B-262K 与 GLM-4-9B-1M 上，RULER 的有效上下文只到 32K 和 64K（以 85% 为阈值），LLaMA-3-8B 在 128K 的平均分是 77.6，已经低于阈值 [1]。这形成一个很重要的边界：1M 的加速证据和 32K 到 64K 的精度证据不是同一个长度。论文可以说「在 1M 上快 10 倍」，也可以说「在 32K 和 64K 上保持有效」，但不能合起来说「在 1M 上保持精度」。

把 MInference 和 Quest 放在一起，离线与在线的取舍就清楚了。Quest 为每个 query 用 page 的 min/max key 估计重要性，32K 上 self-attention 快 7.03 倍，端到端 2.23 倍（4-bit 权重）[5]；它比 MInference 多了一次 metadata 读取，但能跟着 query 变。MInference 不用读 metadata，代价是 head 的图案固定，遇到分布外的输入无法调整。两者不是谁替代谁，而是「稳定 prefill 负载」与「query 分布变化大」两种场景的选择。

## 5. 在线统计：用一次廉价扫描换自适应性

这一支的共同点是：不训练选择器，而是在运行时为每个块算一个摘要，再用摘要给块打分。四篇工作的差别在摘要形式、扫描复杂度和系统位置：Quest 与 InfLLM 都做 block 摘要，但一个在 GPU page 上，一个在 CPU memory 上 [5][6]；AB-Sparse 与 PISA 则分别改粒度与改扫描 [7][4]。

Quest 用 page 内每个特征维度的 min/max key 作为摘要。对每个 query，它用 Query 与 min/max 估计 page 的 criticality，只加载 Top-K page。page size 是 16，token budget 从 256 到 4K；在 PG19、passkey 与 LongBench 上报告 negligible accuracy loss，32K 上 self-attention 快 7.03 倍，端到端 2.23 倍 [5]。这个方法的聪明之处是摘要只有 KV 的很小一部分，读取摘要的代价远小于读整个 KV；但它假设 page 内的 key 分布可以用逐维极值概括，page 越大，这个假设越粗。与 MInference 的离线图案相比，Quest 多了一次 metadata 读取，换来了跟随 query 变化的能力 [1][5]。

InfLLM 换了摘要：每个 128-token 的 memory unit 选 4 个 representative token 作为单元表示，推理时只把与当前 token 相关的 memory unit 拉进 GPU（Llama-3 配置为 32 个，Mistral 配置为 96 个），其余放 CPU [6]。它和 Quest 都是 block-level 摘要，但系统位置不同：Quest 优化 GPU 上 KV page 的加载，InfLLM 优化 CPU 与 GPU 之间的 memory offload。InfLLM 报告在 128K 与 1024K 上仍能捕获长距离依赖，精度与持续训练的长上下文 baseline 可比，但没有报告 wall-clock 加速 [6]。这不是遗漏，而是它的目标函数是「单卡能放下多长」，不是「每一步快多少」。把 InfLLM 和 Quest 的加速数字直接比，会犯范畴错误。

AB-Sparse 把矛头指向这一支的共同假设：所有 head 用同一个块大小。它测量了 Llama-3.1-8B 与 Qwen3-8B 在 32K 上下文下每个 head 对块大小的敏感度，发现敏感 head 在块从 16 增到 32 时 recall 急剧下降，不敏感 head 则几乎不变；在统一块大小 32 下，平均 recall 只有 89.7% 和 77.8%，按 head 自适应分配块大小后回到 98%，平均块大小反而更大（44.2 和 39.5）[7]。它作为 Quest 的 drop-in 替换，在 RULER 上比 Quest 高 3.51%、2.19%、5.43%，在 LongBench 上高 2.47%、2.61%、2.62%，且没有增加平均 KV budget；decode 延迟在短上下文与 Quest 持平，长上下文因为 INT4 centroid 量化而更快 [7]。这是语料里最直接的一个「改一个设计假设，精度就回来」的证据。

PISA 则把矛头指向选择本身。常规 block-sparse 要为每个 query 给所有 block 打分，整体 O(N²/C)；PISA 建一个 coarse-to-fine 的 key 金字塔，从最粗层开始做 LogSumExp Top-K，只展开选中的候选，选择复杂度降到 O(N log N) [4]。在 64K、128K、256K 上，它的 block-selection latency 比 NSA 的 selected-attention 分支（BSA）快 2.86、5.31、9.95 倍；但在 4K 到 16K，BSA 反而更快 [9][4]。这个 crossover 很关键：分层路由有固定开销，只有块数足够多时才回本。精度上，PISA 在 commonsense 上与 BSA 相当，在 retrieval 任务上更好；它的 RULER 只用了四个 NIAH 家族，没有 multi-hop 或 aggregation 分项 [4]。

| 方法 | 块摘要 | 打分方式 | 块大小 | 阶段 | 选择开销落点 |
|---|---|---|---|---|---|
| Quest | 逐维 min/max key | Query 与 min/max 估计 page criticality | 16 | decode | 每次 forward 读 metadata，O(页数) |
| InfLLM | 4 个 representative token / 128-token unit | 代表 token 与当前 token 的相关性 | 128 | decode | 每次 lookup 32/96 个 unit，含 CPU-GPU 搬运 |
| AB-Sparse | block centroid（INT4） | centroid 与 Query 的点积 | 16/32/64 按 head 自适应 | decode | 校准在离线，打分在运行时 |
| PISA | 多层 pooled key 金字塔 | 逐层 LogSumExp Top-K | 64 | 两阶段 | 运行时 O(N log N)，短上下文有固定开销 |

表的结论：四种方法都把「选哪些块」做成了一次廉价扫描，但摘要越便宜，选择越粗；扫描越精细，固定开销越大。Quest 与 InfLLM 证明摘要可以很小，AB-Sparse 证明摘要的粒度假设会直接掉精度，PISA 证明扫描本身也能成为瓶颈。这一支的取舍不是「用什么摘要」，而是「把有限的选择预算花在摘要精度还是扫描范围上」。

## 6. 学习 indexer：把选择搬进训练

这一支的共同点是选择器有学习参数。训练成本从 0.5B token 的 gate 蒸馏，到 260B token 的继续预训练，再到 3T token 的从头训练，跨度近四个数量级。成本差异决定了方法能覆盖的阶段和能达到的稀疏率：SeerAttention 只需 0.5B token 的 gate 蒸馏，MSA 则要 3T token 从头训练 [8][3]；NSA 与 MoBA 在两者之间 [9][2]。

SeerAttention 是最轻的一档。它给每个 attention 加一个 AttnGate：对 Q、K 做序列维 pooling，过线性层，点积得到 block 分数，再用 block-sparse FlashAttention kernel 只算选中的块。对预训练模型，只训练 gate，用标准 attention 的 pooled map 做 self-distillation；Llama-3.1-8B 上只用 0.5B token，约 40 张 A100 小时 [8]。它在 128K、90% 稀疏率下报告 7.3 倍 kernel 加速；但同一篇论文里，LongBench 与 RULER 的平均端到端 prefill 加速只有 1.41 倍 [8]。这两个数字的落差是本文最想强调的：kernel 快了 7.3 倍，端到端只快 1.41 倍，因为 gate 前向、索引构建、非 attention 部分都没有消失。与 MInference 的零训练成本相比，SeerAttention 用约 40 张 A100 小时换更高的稀疏率上限 [1][8]。精度上，它在 50% 稀疏率下 LongBench 54.20 对 dense 54.07，RULER 平均只低 0.41 个百分点；128K 上稀疏率超过 80% 时，分数略低于稀疏率不到 50% 的 DuoAttention [8]。高稀疏、长长度是它的边界。

NSA 把选择做进预训练。它用三条路径：压缩的粗粒度 token、选中的细粒度 block、以及局部 sliding window；压缩块大小 32，选中块大小 64，选 16 个块 [9]。模型是 27B total、3B active 的 MoE，预训练 260B token；在 64K 上报告 decode 11.6 倍、forward 9.0 倍、backward 6.0 倍加速，并在 general benchmark、LongBench 与 reasoning 上报告与 full attention 持平或更好 [9]。NSA 的 related work 还给了一句很关键的批评：Quest 这类每个 head 独立选 KV 的方法，在 GQA 下实际访问的是同一组内所有 query head 选中块的并集，所以计算稀疏不一定变成 KV 访存稀疏 [9]。这句话把「选择单位」从方法细节提升成了架构约束，第 8 节会展开。

MoBA 把 MoE 的路由思想搬到 attention：把上下文切成大块，用 mean-pooled K 作为块表示，gate 为每个 query 选 Top-K 块；它保留 full attention 与 sparse attention 的切换能力 [2]。在 1M 预填充上报告 6.5 倍加速，10M 上 attention 计算时间降 16 倍；在 128K、62.5% 稀疏率下 RULER 得分 0.7818，对 full attention 0.7849 [2]。它在 1M 设置下的块大小是 4096，比 Quest 的 16 和 NSA 的 64 大了两个数量级。与 NSA 的 64-token 细块相比，MoBA 的 4096-token 粗块把路由成本压得更低，但块内选择更粗，也让「块内哪些 token 重要」这件事被平均掉 [2][9]。MoBA 的评估还有一个重要条件：prefill 用稀疏，generation 切回 full attention [2]。所以它的 6.5 倍不能直接读成 decode 加速。

MSA 是语料里把生产部署证据给得最完整的一篇：1M 上下文、两阶段 wall-clock、109B 模型精度放在同一篇里。它基于 GQA，给每个 GQA group 配一个轻量 Index Branch，用 max-pooling 给 KV block 打分，每个 group 独立选 Top-k；主分支只对被选中的 block 做精确 attention。块大小 128，k=16，即每个 query 每个 group 选 2048 个 token；模型是 109B 参数的 MoE，训练 3T token [3]。它报告 1M 上下文下每 token attention FLOPs 降低 28.4 倍，H800 上 14.2 倍 prefill、7.6 倍 decode 的 wall-clock 加速，并在下游 benchmark 上与 GQA 持平 [3]。MSA 自己解释了折扣：稀疏 attention 引入了 index construction、top-k selection、reverse-index materialization、query gathering 与 load balancing，访存还不规则，所以 runtime 不会等比例于 FLOPs [3]。与 SeerAttention 的 post-hoc gate 相比，MSA 的 Index Branch 是从头训练的一部分；与 NSA 的 64-token 块相比，MSA 用 128-token 块并按 GQA group 共享选择 [3][9][8]。这段话是 RQ1 的直接答案。

| 方法 | 选择器 | 训练成本 | 块大小 | 阶段 | 报告加速 |
|---|---|---|---|---|---|
| SeerAttention | 可学习 AttnGate（pooled Q/K + 线性层） | 0.5B token，约 40 A100 小时 | 64 | prefill | kernel 7.3 倍，端到端 1.41 倍 |
| NSA | 压缩路径 + 可学习选择分数 | 27B/3B 模型，260B token | 64（压缩 32） | 两阶段 | decode 11.6 倍，forward 9.0 倍，backward 6.0 倍 |
| MoBA | MoE 式 gate + mean-pooled K | 继续预训练到 1M | 4096 | prefill（评估时 decode 用 dense） | prefill 6.5 倍（1M），attention 计算 16 倍（10M） |
| MSA | GQA group 级 Index Branch + KL 对齐 | 109B MoE，3T token | 128 | 两阶段 | FLOPs 28.4 倍，prefill 14.2 倍，decode 7.6 倍 |

表的结论：学习 indexer 把选择成本从推理挪到训练，换来了更高的稀疏率上限；但训练成本从 0.5B 到 3T token，跨度太大，不能把四篇的加速数字放在同一把尺子上。SeerAttention 与 MSA 都学一个轻量 scorer，但前者是 post-hoc gate、只做 prefill，后者是从头训练、两阶段都做；NSA 与 MoBA 都把选择放进预训练，但 NSA 用 64-token 细块加压缩路径，MoBA 用 4096-token 粗块加 MoE gate。两条路线的差别不是「学不学」，而是「学什么粒度、在哪个阶段学、愿意付多少训练成本」。

## 7. 精度证据：平均分把什么压掉了

这一节回答 RQ2。先把标尺立起来：RULER 用 13 个任务评了 17 个长上下文模型，发现 NIAH 几乎满分，但多跳追踪与聚合任务随长度明显下降；声称支持 32K 以上的模型里，只有一半在 32K 还能保持可接受的表现 [10]。这意味着「NIAH 过了」只能证明模型会检索，不能证明它会跨块组合证据。Block-sparse 的精度证据如果只停在 NIAH 或平均分，就正好落在这个盲区里。MInference、SeerAttention、MSA 都用了 RULER，但报告的长度和分项不同 [1][3][8][10]。

MInference 对 RULER 的处理值得细看。它报告在 RULER 的复杂多跳与聚合任务上保持了长上下文表现，甚至在 32K 以上超过 full attention；但同一张表里，LLaMA-3-8B-262K 与 GLM-4-9B-1M 的有效上下文只到 32K 和 64K，LLaMA-3-8B 在 128K 的平均分 77.6，低于 85% 阈值 [1]。这里要区分「相对 dense 不降」与「绝对能力还在」：前者可以在 dense 自己也退化时成立，后者要求分数本身够高。把 sparse 在 64K 上超过 dense 读成「稀疏更好」，是把 dense 的退化算进了 sparse 的功劳。

SeerAttention 的证据更细。50% 稀疏率下 LongBench 54.20 对 dense 54.07，基本持平；RULER 平均只低 0.41 个百分点，但 128K 上稀疏率超过 80% 时，分数略低于稀疏率不到 50% 的 DuoAttention [8]。这说明精度损失不是均匀分布在所有长度上的：中等稀疏、32K 到 64K 可以守住，高稀疏、128K 开始失守。与 MInference 在 32K/64K 的持平相比，SeerAttention 的持平只在 50% 稀疏率附近成立 [1][8]。它的 LongBench 平均分掩盖了 128K 这一端的下降，因为平均里混入了大量 0 到 8K 的样本。

MoBA 的证据是 128K、62.5% 稀疏率下 RULER 0.7818 对 0.7849，差距很小；1M 上用 NIAH 验证，分数令人满意 [2]。但它的 sparse 只用在 prefill，generation 切回 full attention，所以这份精度证据不覆盖 decode 阶段的块选择。把它和 Quest、MSA 这类 decode 也稀疏的方法比精度，条件不对等。

MSA 的证据最能说明「平均分压掉了什么」。RULER-128K 总分 72.12 对 full 72.00，看似持平甚至略好；但分项里 CWE/FWE（聚合）低 1.35，QA 低 1.00，VT 低 1.00，被 MK/MQ/MV 高 2.24 抵消 [3]。也就是说，总分持平是两个方向的误差相互抵消的结果，聚合任务其实退化了。这正是 RULER 原文担心的失败模式：检索型子任务可以补回聚合型子任务的损失，平均分看不出来。与 SeerAttention 的平均分持平相比，MSA 的分项把聚合损失暴露出来 [3][8]。

AB-Sparse 从选择侧给了同一件事的另一个证据。统一块大小 32 时，Llama-3.1-8B 与 Qwen3-8B 的平均 recall 只有 89.7% 与 77.8%，自适应块大小后回到 98%；但端到端 RULER 只比 Quest 高 3.51% 到 5.43% [7]。选择 recall 掉了 10 到 22 个百分点，端到端平均分只动了几分，说明平均分把「选错块」的损失压缩了。对做方法的人来说，这是一个警告：recall 的下降不会等比例地出现在任务分数上，但它在高稀疏、长上下文或聚合任务上会突然兑现。

PISA 的精度证据是 commonsense 与 retrieval：与 NSA 的 selected-attention 分支（BSA）相当，retrieval 更好，没有多跳或聚合分项 [9][4]。这不是缺陷，而是这一支目前的证据边界：选择复杂度的论文先把效率做出来，精度只验到 retrieval。

| 方法 | 评测任务 | 稀疏条件 | 报告结论 | 证据边界 |
|---|---|---|---|---|
| MInference | InfiniteBench、RULER、PG19、NIAH | 每 head 图案；观察到 128K 注意力最高 96.8% 稀疏 | 与 dense 持平或略好 | RULER 有效上下文 32K/64K；LLaMA-3-8B 在 128K 低于 85% |
| Quest | PG19、passkey、LongBench | token budget 256 到 4K | negligible loss | 模型是 MHA 的 LongChat/Yarn-Llama-2，不是 GQA |
| InfLLM | ∞Bench、LongBench | 128-token unit，32/96 unit（Llama-3/Mistral） | 与持续训练 baseline 可比 | 无 wall-clock；1024K 是能力不是速度 |
| SeerAttention | LongBench、RULER、PG19 | 50% 稀疏；RULER 10% 到 85% | 54.20 对 54.07；RULER 低 0.41 | 128K、>80% 稀疏时下降 |
| NSA | general、LongBench、reasoning | 与 baseline 同稀疏率 | 持平或更好 | 64K；训练 260B token |
| MoBA | RULER、NIAH | 128K 62.5%；1M NIAH | 0.7818 对 0.7849 | prefill 稀疏，decode 用 dense |
| MSA | RULER-128K、HELMET、下游 | 1M，块 128，k=16 | 总分 72.12 对 72.00 | 聚合分项低 1.35，被检索分项抵消 |
| AB-Sparse | RULER、LongBench | 块 32 统一 vs 按 head 自适应 | 比 Quest 高 3.51% 到 5.43% | 校准集是 Wikipedia；recall 掉 10 到 22 点 |
| PISA | commonsense、retrieval | 块 64 | 相当或更好 | 无多跳/聚合分项 |

表的结论：所有方法都在自己选的稀疏率与任务集上报告不劣于 dense，部分还更好；跨方法、跨任务的统一比较不存在。能站得住的精度结论是：中等稀疏（约 50% 到 62.5%）、32K 到 128K、以检索和综合 benchmark 为主的任务上，block-sparse 可以接近 dense；高稀疏（80% 以上）、128K 以上、以及需要跨块聚合的任务上，失守的概率明显上升。平均分之所以看不出来，是因为检索型子任务占多数、dense baseline 自己也在退化、不同子任务的误差还会相互抵消。

## 8. Synthesis discussion

把三支放在一起，可以看到四个跨支趋势。

第一，选择开销没有消失，只是换了位置。离线图案把它压到零，但只能选一次；在线统计把它放到每次 forward，扫描范围随块数增长；学习 indexer 把它挪进训练，推理时仍要一次轻量前向。PISA 的 O(N²/C) 说明即使选中块后的 attention 是线性的，选择阶段仍可能是二次的；MSA 的 28.4 倍 FLOPs 只兑现成 14.2 倍 prefill 与 7.6 倍 decode，SeerAttention 的 7.3 倍 kernel 只兑现成 1.41 倍端到端，Quest 的 7.03 倍 attention 只兑现成 2.23 倍端到端。这些折扣不是实现不够好，而是选择、索引、访存与框架开销的固定成本。

| 方法 | 算法/attention 口径 | 端到端口径 | 折扣因子 |
|---|---|---|---|
| Quest | self-attention 7.03 倍 | 2.23 倍（4-bit） | 约 3.2 |
| SeerAttention | kernel 7.3 倍（90% 稀疏，128K） | 1.41 倍（平均 prefill） | 约 5.2 |
| MSA | FLOPs 28.4 倍（1M） | prefill 14.2 倍 / decode 7.6 倍 | 约 2.0 / 3.7 |
| MoBA | attention 计算 6.5 倍（1M prefill） | not reported | 无法计算 |

表的结论：同一方法内部，算法节省到端到端加速要除以 2 到 5；跨方法比较 headline 数字没有意义，因为口径、baseline、硬件、batch 都不同。

第二，GQA 把选择的单位从 head 改成了 group。Quest 的 7.03 倍 attention 与 2.23 倍端到端是在 MHA 的 LongChat 与 Yarn-Llama-2 上测的 [5]；NSA 指出，每个 head 独立选 KV 在 GQA 下访问的是组内并集，计算稀疏不一定变成 KV 访存稀疏 [9]。MSA 因此把 Index Branch 做成每个 GQA group 独立选 Top-k [3]。这不是「Quest 过时了」，而是条件变了：在 MHA 上，head 级选择的收益可以直接兑现；在 GQA 上，选择单位必须跟 KV 共享单位对齐，否则省了计算没省访存。把 Quest 的 decode 数字直接搬到 GQA 模型上，是一个常见的误读。

第三，块大小是方法的一部分，不是超参数。语料里的块大小从 16（Quest）到 128（InfLLM、MSA）到 4096（MoBA），跨了两个数量级。小块提高选择分辨率，但增加元数据与路由次数；大块降低路由成本，但把块内的重要 token 平均掉。AB-Sparse 证明每个 head 的最优块大小不同，统一块大小会掉 recall [7]；MoBA 用 4096 的粗块换 1M 上的路由效率 [2]；MSA 用 128 的细块加 group 级选择换精度 [3]。目前没有一条成本模型能预先给出「给定 head、稀疏率、硬件，块大小该取多少」，这是第 9 节的开放问题之一。

第四，证据覆盖不对称。加速证据常做到 1M，精度证据常停在 32K 到 128K：MInference 在 1M 上报 10 倍加速，但 RULER 有效上下文是 32K/64K [1]；MoBA 在 1M 上报 6.5 倍 prefill，RULER 只到 128K，而且 decode 用 dense [2]；MSA 在 1M 上报 wall-clock，RULER 只到 128K [3]。这不是说这些结果不可信，而是说「1M 快」与「1M 准」是两份不同的证据，不能互相替代。

方法论上还有一个共同问题：没有统一的 baseline。MInference 对 FlashAttention-2，Quest 对 FlashInfer，SeerAttention 对 FlashAttention-2，MSA 对 dense GQA，MoBA 对 FlashAttention；长度、batch、硬件、是否含 prefill/decode 都不同。语料里只有 MSA 同时报告 FLOPs、prefill wall-clock 与 decode wall-clock，也只有它把主要 overhead 逐项点名 [3]。这意味着本文的跨方法比较只能比「作者报告的口径」，不能比「同一条件下的真实速度」。

一个表面上的矛盾值得单独处理：MInference 报告 sparse 在 64K 的 RULER 上超过 dense [1]，而 RULER 原文报告 dense 模型随长度退化 [10]。两者并不矛盾。MInference 的比较是同一长度下 sparse 对 dense，dense 自己在 64K 已经掉了；sparse 通过丢掉 distractor 块，可能掉得更少。这是「相对不降」，不是「绝对够用」。把这类结果写成「block-sparse 提升长上下文能力」，是校准错误。

## 9. Open problems and future directions

1. **统一的三层口径与选择开销单列**。语料里没有一篇把 FLOPs、kernel latency、端到端 latency 三层都报齐，并把选择阶段单独列成一行；Quest 与 SeerAttention 有局部 breakdown，但不可横向比较 [5][8]。下一步需要一套固定的报告模板：同一模型、同一长度、同一 batch、同一硬件，分别报 dense、kernel、端到端，以及 selection 占比。没有这个，跨论文的加速比不可加总。

2. **学习选择器与自适应块大小的组合是空单元格**。AB-Sparse 证明 per-head 块大小能显著恢复 recall [7]；SeerAttention、NSA、MoBA、MSA 都学选择器，但块大小固定 [8][9][2][3]。把「学出来的选择分数」与「按 head 校准的块大小」结合，是一个没有被验证的组合。它可能同时提高精度与路由效率，也可能让 block 数变得不可预测、破坏 kernel 的规则访存。

3. **跨块聚合的压力测试**。RULER 已经提供了 multi-hop 与 aggregation 任务 [10]，MSA 的 RULER-128K 分项显示了聚合任务低 1.35 而总分持平 [3]，但语料里没有一篇把「稀疏率 vs 跳数」或「稀疏率 vs 聚合距离」画成曲线。需要的是固定模型、固定块大小，逐步提高稀疏率，分别看 retrieval、multi-hop、aggregation 三条曲线的交叉点。这个交叉点比平均分更能定义方法的适用边界。

4. **GQA 下的 decode 选择器**。Quest 的证据在 MHA 上 [5]，NSA 指出 head 级选择在 GQA 下不省 KV 访存 [9]，MSA 用 group 级选择解决了这个问题 [3]，但没有一篇在同一个 GQA 模型上把 head 级、group 级、token 级选择放在一起比。decode 的每一步都要做选择，选择开销占比比 prefill 更高；这个比较缺失，导致「decode 加速」的证据链不完整。

5. **块大小的成本模型**。现有取值从 16 到 4096，依据是经验或校准，没有一条模型把块大小、head 敏感度、稀疏率、访存粒度与硬件 tile 联系起来。AB-Sparse 的校准方法是一个起点 [7]，但它依赖 Wikipedia 校准集，跨域是否稳定还没有证据。若块大小能由 head 统计量在部署前预测，自适应块大小才可能进入生产。

6. **对你手头 BlockSkip 的直接含义**。你在 10-06 的记录里把 token 级跳过改成 64-token 块，时间省 31%，准确率 71.2 对 70.4，只跑了一次。这篇综述的两条主线正好对上：31% 是端到端还是 attention-only，选择开销有没有单列；0.8 分有没有大过 seed 波动；RULER 的 multi-hop 与 aggregation 分项有没有单独看。如果 10-30 前要投 workshop，至少补三样：选择开销单列、3 个 seed、RULER 分项。你的 64-token 块落在语料的 16 到 128 区间，AB-Sparse 的 per-head 敏感度结果提示统一 64 可能不是每个 head 的最优值，这一点值得在消融里试一次。

## 10. Conclusion

RQ1 的答案是：2024 年以来，block-sparse 的选择信号从离线图案（MInference）扩展到在线统计（Quest、InfLLM、AB-Sparse、PISA）与学习 indexer（SeerAttention、NSA、MoBA、MSA）。三种放置方式的选择开销分别落在部署前、每次 forward、训练里；选择开销越大，越有可能把精度做高，但也越难把算法节省兑现成端到端加速。在报告了同一口径的方法里，算法到端到端的折扣因子约为 2 到 5；选择阶段本身在常规 block-sparse 里仍是 O(N²/C)，PISA 的 O(N log N) 是目前语料里唯一直接针对这个二次项的方案 [4]。因此，判断一个 block-sparse 方法，先看它把选择成本放在哪，再看它的 headline 是哪个口径，最后看它的精度证据覆盖到哪个长度与哪类任务。

RQ2 的答案是：block-sparse 的精度持平是有条件的。中等稀疏（约 50% 到 62.5%）、32K 到 128K、以检索和综合 benchmark 为主的任务上，多篇工作报告了接近 dense 的结果 [1][2][3][8]；高稀疏（80% 以上）、128K 以上、head 对块大小敏感、以及需要跨块聚合的任务上，失守的概率上升 [3][8][7][10]。平均分之所以经常看不出失败，是因为检索型子任务占多数、dense baseline 自己随长度退化、不同子任务的误差相互抵消。可信的精度结论应该报绝对分数、分任务、分长度，而不是只报「与 dense 持平」。

本文的贡献不是提出新方法，而是把「选择开销」与「证据覆盖」放在同一张图上：前者解释加速比为什么打折，后者解释精度为什么在平均分上看起来没事。对准备进入这个方向的人，最实用的两条判据是：先问省下的算力在哪一层变成时间，再问精度在哪个任务上失守。

## References

[1] H. Jiang, Y. Li, C. Zhang, et al., "MInference 1.0: Accelerating Pre-filling for Long-Context LLMs via Dynamic Sparse Attention," NeurIPS 2024. [arXiv](https://arxiv.org/abs/2407.02490) [NeurIPS](https://proceedings.neurips.cc/paper_files/paper/2024/hash/5dfbe6f5671e82c76841ba687a8a9ecb-Abstract.html)

[2] E. Lu, Z. Jiang, J. Liu, et al., "MoBA: Mixture of Block Attention for Long-Context LLMs," NeurIPS 2025 (Spotlight). [arXiv](https://arxiv.org/abs/2502.13189) [NeurIPS](https://neurips.cc/virtual/2025/poster/117997) [code](https://github.com/MoonshotAI/MoBA)

[3] X. Lai, W. Xu, Y. Yang, et al., "MiniMax Sparse Attention," arXiv:2606.13392, 2026. [arXiv](https://arxiv.org/abs/2606.13392) [code](https://github.com/MiniMax-AI/MSA)

[4] B. Tang, Z. Qin, Y. Pan, et al., "Block Sparse Attention with Log-Linear Complexity," arXiv:2609.31093, 2026. [arXiv](https://arxiv.org/abs/2609.31093)

[5] J. Tang, Y. Zhao, K. Zhu, et al., "Quest: Query-Aware Sparsity for Efficient Long-Context LLM Inference," ICML 2024. [arXiv](https://arxiv.org/abs/2406.10774) [PMLR](https://proceedings.mlr.press/v235/tang24l.html)

[6] C. Xiao, P. Zhang, X. Han, et al., "InfLLM: Training-Free Long-Context Extrapolation for LLMs with an Efficient Context Memory," NeurIPS 2024. [arXiv](https://arxiv.org/abs/2402.04617) [NeurIPS](https://neurips.cc/virtual/2024/poster/94480)

[7] D. Liu, R. Wang, C. Chen, et al., "AB-Sparse: Sparse Attention with Adaptive Block Size for Accurate and Efficient Long-Context Inference," arXiv:2605.12110, 2026. [arXiv](https://arxiv.org/abs/2605.12110)

[8] Y. Gao, Z. Zeng, D. Du, et al., "SeerAttention: Self-distilled Attention Gating for Efficient Long-context Prefilling," NeurIPS 2025 (arXiv version: "Learning Intrinsic Sparse Attention in Your LLMs"). [arXiv](https://arxiv.org/abs/2410.13276) [NeurIPS](https://papers.neurips.cc/paper_files/paper/2025/hash/50e9dbc4ab68d94f15261ddc26c8ca2b-Abstract-Conference.html)

[9] J. Yuan, H. Gao, D. Dai, et al., "Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention," ACL 2025 (Best Paper). [arXiv](https://arxiv.org/abs/2502.11089) [ACL](https://aclanthology.org/2025.acl-long.1126/)

[10] C.-P. Hsieh, S. Sun, S. Kriman, et al., "RULER: What's the Real Context Size of Your Long-Context Language Models?," COLM 2024. [arXiv](https://arxiv.org/abs/2404.06654) [code](https://github.com/hsiehjackson/RULER)

> 为什么这么做：先把题目收成两个能回答的问题，再按「选择信号在哪里产生」分三支，避免写成论文串烧（deep-research Step 0；synthesis-framework 的 MECE 聚类；T01）。
> 项目 notes.md 里 10-06 的 31% 省时和 71.2 对 70.4 只跑了一次，所以 RQ2 专门盯「平均分掩盖了什么」（E05、E02；notes.md）。
> **先问省下的算力在哪一层变成时间，再问精度在哪个任务上失守。**
> 下次先拉一张统一口径表（FLOPs / kernel / end-to-end），再决定读哪些论文。
> ▸ 决策：选 9 篇方法 + 1 篇评测基准，放弃把 token 级 KV eviction 与线性注意力纳入正文（我定的，按你给的 2023 年后、十篇以内）。

**卡片提醒**

- **B02**（进新方向先读宽）：这次从 10 篇的引用链滚雪球，才看到块大小从 16 到 4096 的跨度；你 notes 里只试了 64，值得再扫一遍同类的块粒度工作。
- **E02**（证据先于叙事）：71.2 对 70.4 只跑一次，先别在 abstract 写 outperforms；先补 seed 与 RULER 分项，再决定这句话怎么写。
- **E05**（差距要大过种子间波动）：0.8 分可能小于 seed 波动；主结果至少 3 个 seed，或写明算力理由。

完整报告写在 `.duck/reports/2026-10-26-survey.md`；方向背景写进 `.duck/background.md`；`.duck/notebook.md` 与 `.duck/decisions.md` 也已更新。

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
