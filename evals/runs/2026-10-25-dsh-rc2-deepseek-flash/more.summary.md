# e2e dsh 0.2.1-rc.2 more c4d0f11, Doctor Duck 345d618 ((profile default))

42/43 checks passed; must failed 0, should failed 1

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":246577,"outputTokens":218121,"cacheReadTokens":28802432,"cacheWriteTokens":0,"totalTokens":29267130}

## survey: `/duck-survey 块稀疏注意力用于长文本推理加速。范围小一点：只看 2023 年以后，十篇以内，研究问题你来定两个。` (762s)

- [x] must: read library/deep-research
- [x] must: wrote a survey report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number
- [x] must: not turned on: hook injected the idle note
- [ ] should: cites checkable sources

<details><summary>reply</summary>

按你的范围做了：2023 至 2026 年，10 篇，两个研究问题。完整报告存在 `.duck/reports/2026-10-26-survey.md`。

# 块稀疏注意力用于长文本推理：选择信号的代价与加速口径的断层

## Abstract

2023 年以来，长文本推理的块稀疏方法从「设计固定稀疏模式」转向「设计块选择器」。本文以 10 篇 2023 至 2026 年的工作为语料，问两个问题：固定结构、免训练打分、可学习门控三类选择信号，各自把成本转移到哪里；算法上跳过的块，为什么没有等比例变成墙钟时间。结论是：固定结构用一条稠密逃逸路径换质量，免训练打分用一次预读换适应性，可学习路由用训练换掉训练与推理的错配；稀疏率到加速的损耗主要来自阶段不对称（prefill 计算受限、decode 带宽受限）、块粒度与 GQA 的并集读取、以及选择器自身的读取成本。文献里的加速倍数因此不可直接横向比较；更有意义的指标是「每节省一单位注意力计算，选择器要读多少」。

## 1. Introduction

一个 8B 模型在单张 A100 上处理 1M token 的 prompt，prefill 要 30 分钟 [1]。块稀疏注意力是对这个数字最直接的回答：把 KV 切成块，只计算重要的块。但把 2023 年以来的代表工作报告的加速放在一起，会看到 1.13x 到 22.2x 的跨度。这个跨度并不说明方法之间差了二十倍，而说明它们测的不是同一个量：有人报 attention kernel，有人报 prefill 延迟，有人报 decode 端到端，有人报长文档端到端，还有人拿滑动窗口重算当基线。

如果只按稀疏率排序，这些量会被压进同一张表。本文换两个轴：**选择信号**，即在推理时到底是什么在决定「算哪些块」；**阶段**，即省下的是 prefill 的计算还是 decode 的带宽。沿这两个轴读，十篇工作会显出同一条线索：真正的进展不是把稀疏率推得更高，而是把选择信号的读取成本压到块粒度，再把内核与块粒度对齐。

这也解释了为什么这批论文的自我描述在 2023 年之后变了。早期工作描述的是模式：A-shape、Vertical-Slash、滑动窗口。后来的工作描述的是选择器：Quest 用 page 的 min/max 估计相关性，XAttention 用反对角线和给块打分，BSFA 直接算候选块的精确 QK 再比阈值 [2]，NSA 则把选择器训练进模型 [3]，MoBA 把 MoE 的路由搬进注意力。共同的对象已经不是「稀疏模式」，而是「选择器」。按模式分类会遮住成本落在哪里，按选择器分类才能问出下面的问题。

本文回答两个研究问题：

**RQ1**：固定结构、免训练打分、可学习门控三类块选择信号，分别在什么条件下保住长上下文质量，又各自把成本转移到哪里？

**RQ2**：算法上跳过的块，为什么没有等比例变成墙钟时间？阶段、块粒度、GQA、选择器开销与评测口径，各自决定多少折算率？

第 2 节说明检索与纳入标准；第 3 节给出分类轴和语料在轴上的位置；第 4 至 6 节按三类信号展开，每节内部做同句比较；第 7 节跨分支分析稀疏率与加速的断层；第 8 节列出仍未被这批证据回答的问题；第 9 节逐条回答两个 RQ。

## 2. Methodology

检索在 2026-10-26 执行，覆盖 2023-01 至 2026-10。五个视角：主流块稀疏与动态稀疏；系统与 kernel；质疑与负结果（稀疏是否真的变快）；相邻的结构稀疏（head 级、窗口级）；2026 年前沿。关键词按「机制 × 任务」和「领域 × 评测」两组构造，包括 block-sparse attention、dynamic sparse attention、long-context inference、KV cache page/block selection、top-k block、sparse FlashAttention、hardware-aligned sparse attention、trainable sparse attention。检索源为 arXiv、ACL Anthology、NeurIPS/ICML/ICLR 的 proceedings 与虚拟会场页、OpenReview，以及官方代码库的 README。

纳入标准：块级或 page 级的选择，或固定的块结构稀疏；目标是长上下文推理加速；2023 年及以后；同时报告质量与效率。本文把固定窗口与 head 级分工当作块结构稀疏的退化情形纳入，因为它们是块选择器要打败的基线；严格按 block mask 定义的读者可以把第 4 节当作背景。排除：没有块结构的 token 级 KV 淘汰；线性注意力与状态空间模型；权重稀疏与通道稀疏；只谈训练加速、不给推理证据的工作；没有公开论文或代码、无法核对主张的工作。语料最终 10 篇，是本次的范围上限，不是领域全集。

每一篇都做了两步核对：先在 arXiv、ACL Anthology 或会议页确认标题、作者、venue 与年份；再把正文引用的数字与摘要、论文 HTML 或官方 README 对照。摘要没有给的数字，表中写「摘要未给」，不用记忆补。方法细节只在读到论文正文或官方说明时才写，否则停在摘要级。限制有四条：只检索英文文献；没有独立复现任何一篇的实验；十篇上限没有纳入分页 KV 的系统底座、2025 年的若干 prefill 方法与早期的可学习块选择；也没有覆盖自适应块大小与 token 重排两条线。这是本次的范围限制，不是领域空白。主检索串行完成，另做了一次对抗性补查，用来找反例和漏项。

## 3. Taxonomy

第一条轴按「推理时什么在决定块集合」分三类。**固定结构**：块集合由位置、head 角色或分片方式预先决定，不看当前 query。**免训练打分**：块集合由当前 query 与 KV 的某种统计量在推理时决定，打分器不训练。**可学习门控**：块集合由训练过的门控决定，门控参数与模型一起或在后训练阶段学出来。这条轴判的是「决定权在哪里」，不是「参数在哪里」，所以 DuoAttention 归固定结构（head 角色在推理时不变），MInference 归免训练打分（模式离线选，索引在推理时按输入建），SeerAttention 归可学习门控（只训练 gate，基座冻结）。

第二条轴按「省的是哪一段的瓶颈」分：prefill 计算、decode 带宽、两个阶段都覆盖。两条轴交叉，十篇的位置如下。

| 选择信号 | prefill 计算 | decode 带宽 | 两个阶段都覆盖 |
|---|---|---|---|
| 固定结构 | 空 | StreamingLLM [4] | DuoAttention [5] |
| 免训练打分 | MInference [1]、XAttention [6]、BSFA [2] | Quest [7] | InfLLM [8] |
| 可学习门控 | SeerAttention [9] | 空 | NSA [3]、MoBA [10] |

表 1 的两个空格值得分开看，不是排版遗漏。「固定结构 × prefill」为空：本语料里的固定结构要么服务流式 decode，要么服务 head 级分工，没有一篇用固定的块模式专门做 prefill。「可学习门控 × 只做 decode」为空则不重要：可学习方法的训练成本本来就要摊到两个阶段，只做 decode 在经济上不成立。「免训练打分 × 两个阶段」由 InfLLM 填上，但它报的是质量与显存，不是分阶段的端到端延迟。所以这一格的缺口不是覆盖，而是测量：没有一篇免训练方法在匹配的稀疏率、batch 与长度下同时报 prefill 和 decode 的端到端延迟。这正是 RQ2 要问的断层在语料层面的表现。

有三篇 straddler 需要说明。MInference 的模式族是离线按 head 选的，但稀疏索引在推理时按输入动态构建，所以它同时像固定结构和免训练打分；本文按「索引是否随输入变」把它放进后者。DuoAttention 的 head 角色是优化出来的，但推理时不再随输入变，所以按「推理时是否变」放进固定结构。SeerAttention 只训练 gate、基座冻结，所以它在「免训练」与「可学习」之间；本文按「打分器是否训练过」把它放进可学习。这三篇放在轴上是刻意保留的：它们挑战「固定 vs 动态」的二分，也正好说明真实系统很少是纯的。

## 4. 固定结构：块稀疏的退化基线

这一路不问「哪些块重要」，而是假设重要性服从位置或 head 角色。选择成本接近零，代价是假设不成立时没有退路。

StreamingLLM 是这条线的起点，也是块稀疏的退化情形。它发现窗口注意力一旦超过 cache 长度就崩，而保留最初几个 token 的 KV（attention sink）能把性能拉回来；于是固定保留 sink 加最近窗口，不做任何输入相关的选择，把流式生成推到 4M token，相对滑动窗口重算的基线最高 22.2x [4]。它的质量证据主要是语言建模的困惑度，不是检索型评测；中间上下文取不回来，这是固定结构的原罪。把它放进语料，是因为后面几篇都在回应它设定的问题：窗口之外的信息怎么办。

DuoAttention 把「保留什么」从 token 位置移到 head 角色。它发现只有一小部分 head（retrieval heads）需要全量 KV，其余 head（streaming heads）只看最近 token 和 sink；用合成数据上的轻量优化把两类 head 分开，retrieval heads 保留全量 KV，streaming heads 用常数长度 KV。MHA 上 25% 的 head 保留全量、GQA 上 50%，换来 2.55x/1.67x 的内存下降、2.18x/1.50x 的 decode 加速、1.73x/1.63x 的 prefill 加速，配合量化可在单张 A100 上解 3.3M 上下文 [5]。这是语料里唯一一篇免训练、且同时报 prefill 与 decode 端到端加速的工作。它的稀疏单位是 head，不是 block；block-sparse kernel 在这里是实现细节。与 StreamingLLM 同句比较：两者都靠 sink 和最近窗口保底，但 DuoAttention 把「全量」留给真正做检索的 head，等于把稠密路径从「所有 head 的最近窗口」缩成「少数 head 的全部上下文」，所以它在检索型任务上比纯窗口稳，代价是要先找到哪些 head 是 retrieval head。

两篇放在一起，能看到一个跨分支的模式：固定结构都保留一条稠密路径。StreamingLLM 保留 sink 与窗口，DuoAttention 保留 retrieval heads 的全量 KV。稠密路径是质量的来源，也是加速倍数的上限。所谓「块稀疏」，在这些系统里实际是「稀疏的远距离加稠密的局部或少数 head」。这一点在第 7 节会再出现。

## 5. 免训练的动态选择：先花一次预读

这一路在推理时读一点东西来决定块集合。问题不是「能不能选准」，而是「读这一点东西要花多少」，以及这笔开销放在 prefill 还是 decode 更划算。

InfLLM 读的是块摘要。它把远距离上下文切成 memory unit，每个 unit 只保留若干代表性 token 作为摘要，用当前 query 与这些代表 token 的内积给 unit 打分，只把相关的 unit 取回 GPU；局部窗口与最初 token 仍然保留，整体不需要训练 [8]。它把 100K 序列压到 26G 显存，并在 1,024K 长度上仍能抓到远距离依赖 [8]。摘要没有给统一的加速倍数，它报的是质量与显存；这本身是 RQ2 的一个例子：一个方法可以覆盖两个阶段，却不以分阶段延迟的形式报账。

Quest 读的是 page 级元数据。它给每个 KV page 记下 Key 的最小值和最大值，用当前 query 与这组极值估一个 page 的相关性上界，只加载 Top-K 个 page 做注意力 [7]。元数据是 O(page 数) 而不是 O(token 数)，所以选择器的读取很便宜；代价是上界松，按上界排序不等于按 page 的总注意力质量排序。它在 decode 上报 2.23x 的 self-attention 加速，并称推理延迟降低 7.03x [7]。这两个数字口径不同，不能相乘，也不能直接与 prefill 方法比。另一个条件是 GQA：Quest 让每个 head 独立选 page，而同一 GQA 组内各 head 的选择取并集才是实际 KV 读取量，所以计算省了，带宽未必同比例省。这一点 NSA 在正文里点名说过 [3]。

MInference 读的是离线模式。它为每个 head 在 A-shape、Vertical-Slash、Block-Sparse 三种模式里离线搜一个最合适的，推理时按输入动态建稀疏索引，再用定制 kernel 算 [1]。它不需要预训练或微调，在 A100 上把 1M token 的 prefill 延迟最高降 10x [1]。选择成本主要付在离线，推理时只付索引构建；这是五篇免训练工作里选择器最便宜的一档。但模式族是有限的，离线选定的模式在推理时不再改，遇到分布外的输入没有退路。

XAttention 读的是注意力矩阵的反对角线和。它发现一个块的反对角线元素之和是块重要性的好代理，于是用带 stride 的 QK 子集算这个和，再决定哪些块要算 [6]。这比算全块分数便宜，比 Quest 的 min/max 用了更多 QK 信息，代价也更高。它在 RULER、LongBench、VideoMME、VBench 上评测，报最高 13.5x 的注意力计算加速 [6]。这里的 13.5x 是 attention computation，不是端到端；它说明代理信号可以很便宜，但不说明生成会快 13.5 倍。

BSFA 读的是候选块的精确 QK。它先算候选块的 query-key 相似度，用每个块的最大分数比一个校准过的阈值，跳过约 50% 的计算与内存传输；阈值只需在小数据上校准一次，方法是 training-free 的，kernel 可以直接替换 FlashAttention [2]。它在 Llama-3.1-8B 上报 LongBench 端到端 1.13x、准确率降 1.1%，NIAH 1.24x、降 1%，kernel 本身 1.38x；对照的五个基线里包括 MInference 与 XAttention [2]。这是语料里最 sober 的一个数字：省了约一半计算，端到端只有 1.13x。它也是唯一一篇在语料内部把 MInference、XAttention 放进同一组基线的工作，虽然对照仍由作者自己跑。

五篇放在一起，选择器的读取成本大致形成一条梯子：MInference 的离线模式最便宜，Quest 的 page 元数据次之，InfLLM 的代表 token 再次，XAttention 的带 stride 反对角线再次，BSFA 的精确 QK 最贵。准确率并不沿着这条梯子单调上升：精确分数更准但更贵，离线模式最便宜但最不适应输入。更关键的是，同一把梯子在 prefill 与 decode 上的经济学不同。prefill 的全注意力是 O(N²)，选择器读 1/16 的 QK 可以摊薄；decode 的全注意力是每 token O(N)，选择器读 1/16 的 cache 也要和 KV 加载抢带宽，摊不薄。这解释了为什么 Quest 能在 decode 上报出 7.03x 的延迟下降，而 BSFA 在长文档端到端只报 1.13x：不是后者方法更差，是两者把选择器放在了不同的阶段，分母不同。

还有一层容易被忽略：这五篇都叫 training-free，但「免训练」的成色不同。MInference 要重跑一次离线模式搜索；Quest、XAttention 对另一个模型基本可以直接套；InfLLM 还要管理 CPU 与 GPU 之间的 memory cache；BSFA 要重新校准阈值。这个差别在论文里通常一句话带过，在部署时却是工作量。

## 6. 可学习路由：把选择写进模型

这一路把「选哪些块」变成模型的一部分，用训练信号决定门控。好处是选择分布与模型自己的注意力分布对齐，坏处是适配成本，以及与其他方法不可比。

SeerAttention 是这条线里适配成本最低的。它给注意力加一个可学习的 gate：把 Q 和 K 沿序列维池化，过线性层，相乘得到块级分数，再用 block-sparse FlashAttention 算 [9]。它只训练 gate 参数，基座冻结，用 self-distillation 让 gate 拟合模型自己的注意力；在长上下文 prefill 上比已有方法准确率更高、延迟更低 [9]。摘要没有给统一的加速倍数，所以表中只能写「摘要未给」。它的意义在于把「可学习」与「重训练」拆开：学习选择器不等于重训模型。

NSA 是这条线里适配成本最高的。它把注意力拆成三条分支：压缩后的粗粒度 token、按块选择的细粒度 token、以及滑动窗口；三条分支各有学习到的 gate，输出再合并。整个 27B 模型在 260B token 上预训练，在通用、长上下文与推理评测上维持或超过全注意力，并在 64k 长度的 decode、forward、backward 上都报出加速 [3]。它拿了 ACL 2025 最佳论文。它同时是语料里对 RQ2 诊断得最清楚的一篇：第 2.1 与 2.2 节把「稀疏了但不快」拆成阶段受限的稀疏、GQA 不兼容与 token 级选择的非连续访存三种失效模式，并指出后者会让 FlashAttention 掉回低利用率 [3]。

MoBA 走的是 MoE 式的路由。它把上下文切成块，用 query 与块内 K 的均值池化内积算亲和度，做 top-k 选择；当前块永远被选中以保因果与局部，历史块按 gate 选 [10]。在 64 块、top-k=3 的配置下稀疏率 95.31%，已经部署到 Kimi 的长上下文请求 [10]。但它的官方代码库明确写着：MoBA 需要继续训练现有模型才能获得加速，不是可以直接套到预训练模型上的 drop-in 方案 [10]。这句话很重要，它把 MoBA 的「效率」与免训练方法的「效率」划到了两个可比性之外。

三篇放在一起，所谓「可学习」其实横跨了一个很宽的适配成本谱：SeerAttention 只训 gate，基座冻结；MoBA 要继续训练；NSA 要从头预训练 27B。三者的质量主张因此不能与免训练方法放在同一张表里比，因为模型本身已经变了。这也是语料里最明显的一处「标签相同、代价不同」。

还有一处真正的张力。MoBA 的立论是「less structure」：不要预设 sink 或窗口这类强偏置，让模型自己决定看哪里 [10]。但它的实现仍然硬编码了块划分、top-k、当前块必选和因果约束。NSA 反过来，明确把压缩、选择、窗口三条分支写进结构 [3]。两者都是可学习路由，一个尽量少写先验，一个把先验工程化。现有证据没有判定谁更好：MoBA 有生产部署，但没有与 NSA 在匹配稀疏率下的公开头对头；NSA 有 ACL 规模的预训练与 kernel 数字，但没有 Kimi 那样的线上流量。这是一个未决的张力，不是「两者都好」。

## 7. 综合讨论：从稀疏率到墙钟加速的断层

把十个数字排开，第一件事是承认它们不是同一个量。

| 工作 | 报告的量 | 数字 | 基线或条件 |
|---|---|---|---|
| StreamingLLM [4] | 流式端到端 | 22.2x | 对滑动窗口重算 |
| DuoAttention [5] | decode 与 prefill 端到端 | 2.18x/1.50x；1.73x/1.63x | MHA/GQA，25%/50% 全量 head |
| InfLLM [8] | 质量与显存 | 摘要未给统一倍数 | 100K/26G，1,024K |
| Quest [7] | self-attention 与推理延迟 | 2.23x；7.03x | decode，长上下文 |
| MInference [1] | prefill 延迟 | 10x | A100，1M token |
| XAttention [6] | 注意力计算 | 13.5x | RULER/LongBench/视频 |
| BSFA [2] | 端到端与 kernel | 1.13x；1.38x | LongBench，约 50% 跳过 |
| SeerAttention [9] | 摘要未给统一倍数 | 摘要未给 | prefill |
| NSA [3] | 64k 各阶段加速 | 摘要未给统一倍数 | 27B/260B 预训练 |
| MoBA [10] | 计算时间曲线 | 摘要未给统一倍数 | 95.31% 稀疏率，Kimi |

表 2 的结论写在标题里：同一列里的数字跨越了从 attention kernel 到端到端的多个量级，不能横向排名。能做的比较只有两种：同一篇内部的口径对照，比如 BSFA 的 kernel 1.38x 对端到端 1.13x；以及同一阶段的同口径对照，比如 DuoAttention 的 decode 2.18x 对 Quest 的 decode 7.03x。后一种比较仍然受 batch、模型和基线影响，但至少分母同类。

断层的第一层是阶段。prefill 是计算受限，块稀疏直接砍 FLOPs；decode 是带宽受限，选中的块仍然要读进 SRAM，选择器自己还要读元数据或摘要。NSA 把这写成两种失效模式：阶段受限的稀疏，以及 GQA 下各 head 选择取并集导致的带宽不省 [3]。这条诊断比任何单一方法的加速数字都更能解释「为什么稀疏了但不快」。

断层的第二层是粒度。块大小要服从 tensor core 与连续访存，常见是 64 或 128。稀疏率固定时，块越大，块内被浪费的计算越多；块越小，索引开销与离散访存越重。这是硬件给的下限，不是算法能随手改的参数。本语料里的块级方法都用方法级的统一块大小，没有一篇按 head 调整块大小。这不是说没人想过，而是说这十篇没有覆盖；第 8 节把它列为开放问题。

断层的第三层是选择器自己的读取。第 5 节的梯子说明，选择器越准通常越贵；而在 decode 上，这笔读取与 KV 加载在同一条带宽上竞争。于是存在一个反直觉的结论：**在 decode 上，选择器的成本可能比它省下的注意力更大；在 prefill 上，同样的选择器却可能很划算。** 这也是为什么免训练方法在语料里分成 prefill 侧与 decode 侧两拨，而不是一套方法通吃。

第四层是稠密逃逸路径。第 4 节看到固定结构都保留一条稠密路径；第 5、6 节看到免训练与可学习方法也普遍保留局部窗口（MInference 的 Vertical-Slash、NSA 的 sliding window、MoBA 的 current block）。这意味着论文里的稀疏率是「长距离块的稀疏率」，不是「全部计算的稀疏率」。稠密路径越大，加速上限越低。读论文时若只看稀疏率，会高估实际省下的计算。

把这四层合起来，可以给一个比「加速倍数」更稳的指标：**每节省一单位注意力计算，选择器要读多少。** 这个比值在 prefill 上被 O(N²) 的分母摊薄，在 decode 上被 O(N) 的分母放大；它也能把「稀疏率」与「墙钟加速」之间的缺口量化。本文的判断是：2023 年后的真正进展，更多来自把这个比值压下来（更便宜的代理信号、离线模式、块级元数据）以及把内核与块粒度对齐（NSA 的 arithmetic intensity、BSFA 的 drop-in kernel），而不是单纯把稀疏率从 90% 推到 95%。

## 8. Open problems

**第一，缺一个匹配口径的公共评测。** 语料里没有一篇在相同的模型、batch、序列长度、稀疏率下同时报 prefill 与 decode 的端到端延迟，并把选择器开销单列。BSFA 对 MInference、XAttention 的对照是一个开始，但仍由作者自己跑，且只在自己的设定内。没有这个公共评测，表 2 的数字只能各自成立，不能互相裁决。

**第二，GQA 下的 decode 选择没有定论。** Quest 让每个 head 独立选 page [7]，NSA 让同一 GQA 组共享块选择以减少 KV 读取 [3]。前者选择自由度高但并集读取大，后者读取省但牺牲了 head 间的差异。两者没有在控制变量的条件下比过，谁在什么 batch 下更优仍是开放的。

**第三，选择器的成本下界没有理论。** page 的 min/max、反对角线和、精确 QK、离线模式，这四种信号的准确率与读取成本之间是什么关系，语料里只有零散的消融，没有统一的刻画。本文语料只覆盖固定块数的 top-k 选择，没有覆盖按注意力质量阈值选块的变体。能否用比一个块摘要更少的读取达到同等质量，是一个可以形式化的问题。

**第四，适配成本没有被当作一维来比较。** SeerAttention 只训 gate，MoBA 要继续训练，NSA 要预训练；三者的质量提升分别摊在多少适配算力上，没有一篇给出「每单位适配 FLOP 的质量增益」。这让「可学习路由更准」无法与「免训练打分更便宜」做经济上的比较。

**第五，块大小与块边界仍是方法级超参数。** 十篇里的块级方法都用统一块大小，没有一篇按 head 调整块大小。按 head 自适应块大小、以及用 token 重排把重要 token 聚到更少的块里，这两条线都不在本次语料内，是本次的范围限制。

**第六，没有独立复现。** 所有加速数字都是作者自报，本次检索没有找到第三方复现。对一个以「快」为卖点的方向，这比质量数字更值得补。

**第七，decode 的瓶颈可能不在计算。** 这批工作都在算「跳过多少块」，但如果选中的 KV 仍然超出 HBM，容量而不是 FLOPs 才是绑定约束；此时 kernel 层的稀疏加速会被驻留问题吃掉。语料里没有一篇在 decode 上把容量与计算作为两个独立变量来测。

## 9. Conclusion

回到 RQ1：三类选择信号没有一类全面占优，它们把成本放在了不同的地方。固定结构最便宜，但把成本放在任务假设上，并需要一条稠密逃逸路径来保质量；免训练打分用一次预读换适应性，成本在选择器的读取与（BSFA 那样的）一次性校准；可学习门控把训练与推理的错配消掉，成本在适配算力，而且模型变了之后，它的加速数字与免训练方法不可直接比。匹配稀疏率时，选哪一类由适配预算和阶段决定，不由稀疏率决定。

回到 RQ2：从稀疏率到墙钟加速的损耗有四个来源。阶段：prefill 计算受限，块稀疏直接砍 FLOPs；decode 带宽受限，选中的块还要读，选择器还要抢带宽。粒度：块大小服从 tensor core 与连续访存，太大浪费块内计算，太小增加索引与离散访存。选择器：越准通常越贵，在 decode 上可能得不偿失。GQA：各 head 的选择取并集，计算省了带宽未必省。再加上评测口径的差异，文献里的加速倍数不可横向排名。prefill 侧的大数字被反复报告，但多在 kernel 或 prefill 口径；decode 的端到端收益跨度很大，从 2.18x 到 22.2x，取决于基线与设定；可学习方法的收益则换了一个模型，不能与免训练方法同尺度比较。

本文自己的贡献不是又列了一遍方法，而是把十篇工作放到「选择信号 × 阶段」两个轴上，并提出用「每节省一单位注意力计算，选择器要读多少」来替代稀疏率，作为比较块稀疏方法的第一指标。按这个指标，2023 年后的进展是真实的：选择器更便宜了，内核对得更齐了；但距离「decode 上稳定地把稀疏率换成端到端加速」，还差一个公共评测和一次独立的复现。

## References

[1] H. Jiang, Y. Li, C. Zhang, et al., "MInference 1.0: Accelerating Pre-filling for Long-Context LLMs via Dynamic Sparse Attention," NeurIPS, 2024.

[2] D. Ohayon, I. Lamprecht, I. Hubara, et al., "Block Sparse Flash Attention," NeurIPS, 2026.

[3] J. Yuan, H. Gao, D. Dai, et al., "Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention," ACL, 2025.

[4] G. Xiao, Y. Tian, B. Chen, et al., "Efficient Streaming Language Models with Attention Sinks," ICLR, 2024.

[5] G. Xiao, J. Tang, J. Zuo, et al., "DuoAttention: Efficient Long-Context LLM Inference with Retrieval and Streaming Heads," ICLR, 2025.

[6] R. Xu, G. Xiao, H. Huang, et al., "XAttention: Block Sparse Attention with Antidiagonal Scoring," ICML, 2025.

[7] J. Tang, Y. Zhao, K. Zhu, et al., "Quest: Query-Aware Sparsity for Efficient Long-Context LLM Inference," ICML, 2024.

[8] C. Xiao, P. Zhang, X. Han, et al., "InfLLM: Training-Free Long-Context Extrapolation for LLMs with an Efficient Context Memory," NeurIPS, 2024.

[9] Y. Gao, Z. Zeng, D. Du, et al., "SeerAttention: Learning Intrinsic Sparse Attention in Your LLMs," NeurIPS, 2025.

[10] E. Lu, Z. Jiang, J. Liu, et al., "MoBA: Mixture of Block Attention for Long-Context LLMs," NeurIPS, 2025.

---

## 卡片提醒

- **T01** 选题看重要性，也看有没有攻击路径：这次两个 RQ 都落在能被现有数字直接检验的「口径」上。
- **E02** 证据先于叙事：第 7 节先拆报告口径，再给判断。

> 这次把范围压到 10 篇 2023 年后的块级方法，按「选择信号」而不是稀疏模式分章，是因为读下来加速口径的差异比方法差异更大：NSA 第 2.1 节说很多方法稀疏了却不快，MoBA 的代码库说必须继续训练才能加速。
> **比较稀疏注意力，先对齐阶段、块粒度和基线，再谈加速倍数。**
> 下次先把每篇的加速口径列成表（kernel、prefill、decode、端到端），口径不清的直接标「不可比」。
> ▸ 决策：选「选择信号 × 阶段」两轴，放弃按稀疏模式（A-shape/Vertical-Slash/window）分类（我定的）

完整版已写入 `.duck/reports/2026-10-26-survey.md`，同一段原则也记进了 `.duck/notebook.md`。

</details>

## outline: `/duck-outline paper/main.tex` (145s)

- [x] must: read library/tech-paper-template
- [x] must: wrote a outline report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number
- [x] should: says it uses the technical-paper template

<details><summary>reply</summary>

这是 Technique Paper，用 `tech-paper-template`。

## 1. Paper-type positioning

- **Type**: Technique Paper
- **Rationale**: 长上下文推理是已有问题，论文的贡献是一个块级跳过机制，不是新问题、数据集或 benchmark。

## 2. Thinking template

| Stage | Your content |
|---|---|
| Research background | 长输入（书、代码库）上的 LLM 推理；attention 随长度二次增长；draft 只引了 token-level pruning [prune2023] 和 block-wise computation [dao2022]。**GAP (MAJOR)**：没有点名具体系统或场景，没有 3 到 5 篇近期代表工作，`dao2022` 还放在 Experiments 里。 |
| Limitation 1 | Draft: token-level pruning 的 wall-clock 加速很小（Intro）。**GAP (MAJOR)**：没有引用、没有数字、没有点名方法；1.04x 只在表里出现。 |
| Limitation 2 | **GAP (CRITICAL)**：没有写现有 block-level 方法的局限。论文把「block-level skipping」当成新东西，但这条线已经很挤（MInference、Quest、InfLLM、XAttention、BSFA、NSA、MoBA）。不写这一条，novelty 无法成立。 |
| Limitation 3 (if applicable) | **GAP (MAJOR)**：没有写 estimator 成本与可靠性、threshold 校准、GPU 利用率这三类局限中的任何一类。 |
| Key Idea / Our Goal | Draft: 跳过「estimated contribution 小」的 (query block, key block) 对，用 block means 估、固定 τ=1e-3。**GAP (CRITICAL)**：正文没有把 estimated contribution 定义成 attention mass；代码算的是 block 均值向量的绝对值点积，不是 mass。 |
| Challenge 1 | **GAP (CRITICAL)**：怎样便宜又可靠地估一个 block 的贡献。block mean 会被少数高注意力 token 骗过；绝对值点积丢掉了 score 的符号；没有 false-negative 分析，也没有校准。 |
| Challenge 2 | **GAP (CRITICAL)**：跳过 block 时怎样保 causality 与 softmax 语义。代码里 query block 的均值包含块内未来 token，key block 也没有 causal 约束；softmax 只在选中的列上归一化。 |
| Challenge 3 | **GAP (MAJOR)**：怎样把 block 稀疏变成墙钟加速。不规则 block pattern、kernel 支持、load balance 都没有讨论；1.45x 的测量口径也没写。 |
| Methodology topic sentence | **GAP (CRITICAL)**：draft 只有一句「split into 64-token blocks; estimate from block means; threshold τ=1e-3」，不是一个有模块的 framework。 |
| Module A (addresses Challenge 1) | Block-mean estimator + fixed threshold。**GAP (CRITICAL)**：没有 calibration、没有 per-head 或 per-layer adaptation、没有理论保证、没有 false-negative 分析。 |
| Module B (addresses Challenge 2) | **GAP (CRITICAL)**：没有 causality 或 softmax 处理。 |
| Module C (addresses Challenge 3) | **GAP (CRITICAL)**：没有 kernel 或 system 设计；speedup 只报一个数。 |
| Contribution 1 | **GAP (CRITICAL)**：没有贡献清单。按 draft 的内容，最接近的一条是「training-free block-level skipping with a block-mean estimator」，但没有写成贡献，也没有 section 映射。 |
| Contribution 2 | **GAP (CRITICAL)**：没有第二条。方法只有一个模块，实验只有一张表，撑不起第二、三条贡献。 |
| Contribution 3 | **GAP (CRITICAL)**：同上；摘要的「outperforms existing sparse attention methods」没有实验支撑。 |

## 3. Self-consistency checks

- **Check 1 Limitations → Key Idea: FAIL**。L1（token-level pruning 慢）被 Key Idea（block-level skipping）直接回应，但 L2（现有 block-level 方法的局限）缺失，Key Idea 因此没有 novelty 锚点。Key Idea 也没有说 estimate 怎么做；block-mean 是方法选择，不是 idea 本身。
- **Check 2 Key Idea → Challenges: FAIL**。draft 没有 challenge。把 Key Idea 朴素实现，至少会撞上 C1（估值可靠性）、C2（causality 与 softmax）、C3（墙钟加速）三个障碍，但正文一个都没写；读起来像一个 trick，而不是一个要克服障碍的方法。
- **Check 3 Challenges → Methodology: FAIL**。没有 challenge，就没有一对一映射。方法只有一个模块；C2 和 C3 没有对应模块。
- **Check 4 Methodology → Contributions: FAIL**。没有贡献清单；摘要的「significantly outperforms existing sparse attention methods」和「31%」没有对应 section，也没有对应实验。表里只比了 dense attention 和 token pruning，没有比任何现有 block-sparse 方法。

Integrity gate 结论：**needs user attention**（四项检查全部失败）。

## 4. Severity summary

- **8 CRITICAL, 6 MAJOR, 4 MINOR.**
- 最该先补的三件事：
  1. **补 Limitation 2**：写清现有 block-level 方法做不到什么，并引到具体工作。现在「block-level skipping 是 game-changer」在 2024 年后的文献里站不住；要么把贡献收窄成「training-free + 便宜估计 + causal 正确」，要么换一个真正没人做的点。
  2. **重建骨架**：2 到 3 条 limitation → 2 到 3 个 challenge → 每个 challenge 一个 module → 3 条 contribution，每条标 section。现在 method 只有一个 module，experiments 只有一张表，骨架是塌的。
  3. **补证据**：7B 模型没名字，LongBench 的平均口径没写，只跑了一次没有误差棒；1.45x 没说是 kernel、prefill 还是端到端；τ=1e-3 是怎么选的也没写。先补这些，再谈「significantly」。

CRITICAL 清单：没有 block-level 前作的 limitation；没有 challenge，method 只有一个 module；estimator 是 block 均值绝对值点积，不是 attention mass；没有 causality 与 softmax 处理；「outperforms existing sparse attention methods」没有实验支撑；只跑一次，没有方差；没有贡献清单；speedup 的测量口径没写。

MAJOR 清单：没有 Related Work；7B 模型和 LongBench 口径没写；没有 skip rate 与 Pareto 曲线；「removes noise」是事后解释；31% 与 1.45x 都没定义测量对象；表注缺硬件、序列长度、batch size。

MINOR 清单：「game-changer」「simple, effective and general」是营销话；「delve into」句式；`prune2023` 没有 bibliography；结论重复摘要，没有落到证据。

## 5. Next suggested skill

- 四项检查都失败：先把上面的链条补好，再动笔。补完后用 `/duck-intro` 起草 Introduction；现在不要用 `/duck-polish`，润色救不了骨架。

## 卡片提醒

- **W01** 先把贡献写成一到三条：这稿没有贡献清单。
- **E02** 证据先于叙事：摘要先下「significantly outperforms」，实验只比了 dense 和 token pruning。
- **E05** 差距要大过种子间的波动：notes 写「只跑了一次」，0.8 个点没有误差棒。

> 这稿只有 47 行，摘要和结论都在下判断，中间却没有 limitation → challenge → module 的链；你 10-26 记下的「比较稀疏注意力先对齐阶段、块粒度和基线」也正好戳中这里：1.45x 没说是 kernel 还是端到端，基线只有 dense 和 token pruning。
> **先补逻辑链，再改句子；一条主张没有对应的挑战和模块，就不要写进摘要。**
> 下次先列 2 到 3 条 limitation 和 2 到 3 个 challenge，再写 method 和 experiments。
> ▸ 决策：按 Technique Paper 审，不按 benchmark；放弃逐句润色（我定的）

完整版已写入 `.duck/reports/2026-10-26-outline.md`，原则和决策也分别记进了 `.duck/notebook.md` 和 `.duck/decisions.md`。

</details>

## intro: `/duck-intro 按 paper/main.tex 的内容重写引言。先在对话里给草稿，paper/ 里的文件先别改。` (225s)

- [x] must: read library/intro-drafter
- [x] must: wrote a intro report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number
- [x] must: reminds the student to check facts, numbers and citations
- [x] should: paper/main.tex untouched

<details><summary>reply</summary>

Long-context inference has become a routine workload: models are asked to read books, reports, and codebases, and LongBench evaluates them on inputs averaging thousands of words across single-document question answering, multi-document question answering, summarization, and code completion [1]. The cost of these workloads is dominated by self-attention, whose time and memory grow quadratically with sequence length [2]. IO-aware exact attention such as FlashAttention reduces memory traffic through tiling, but it does not change the quadratic term [2]. Fixed sparse patterns, such as the local-window-plus-global attention of Longformer and the block-sparse attention of BigBird, lower the asymptotic cost, but their patterns are chosen for a task or a pretraining setup and do not adapt to the input [3], [4]. The result is a tension: long-context quality depends on access to distant tokens, yet dense attention over those tokens is what makes inference slow. This tension is visible in long-context evaluations, where models often fail to use information placed in the middle of a long input [5].

Prior work has attacked this cost at several granularities. Token-level pruning and KV-cache eviction keep only a subset of tokens or cache entries [6], [7]. These methods reduce memory footprint and can preserve accuracy, but their savings do not always become wall-clock speedup: the selected tokens are scattered across the cache, so the kernel performs irregular, non-contiguous reads, and the selection itself adds work [8]. A related structural approach splits attention heads into retrieval and streaming roles, but it still keeps a full cache for the retrieval heads [9]. Block-level methods instead skip contiguous regions. Fixed block patterns are cheap, but they are fixed before inference and cannot exploit input-specific sparsity [3], [4]. Dynamic block methods improve adaptivity, but each pays a different cost: MInference profiles attention patterns offline [10], Quest stores per-page key statistics [11], XAttention computes strided block scores [12], and trainable methods such as NSA and MoBA learn the selector, which requires pretraining or continued training [8], [13]. What remains unclear is whether the cheapest possible signal, the block mean, is sufficient to skip blocks without losing accuracy.

We ask whether a training-free, block-level method can turn attention sparsity into wall-clock savings with a signal that costs almost nothing to compute. Our key idea is to score each (query block, key block) pair by the similarity of the two block means and to skip pairs whose score falls below a threshold τ. Because the pairwise scorer operates on one mean vector per block rather than on individual keys, its cost scales with the number of blocks rather than the number of tokens, and the resulting mask is a contiguous block pattern that a block-sparse kernel can execute. The goal is not to outperform every learned selector, but to establish whether this minimal signal is enough to reduce inference time without sacrificing accuracy on a standard long-context benchmark. The question is sharpened by two recent observations: block-memory methods summarize each block with a few representative tokens rather than a single mean [14], and even exact block scores can yield much smaller end-to-end gains than kernel-level gains [15].

Three obstacles stand between this idea and a useful method. First, a block mean is a crude summary: a block whose mean is small can still contain a few tokens with large attention scores, and skipping it would remove exactly the evidence a retrieval-heavy task needs. The scorer must therefore be cheap without being blind to such outliers, and the evaluation must report accuracy rather than only the fraction of skipped blocks. Second, the threshold must be conservative enough to protect accuracy yet aggressive enough to skip a meaningful fraction of blocks; a single global τ may behave differently across layers and heads, where attention distributions vary. Third, block sparsity only helps if it becomes wall-clock time: irregular masks can leave the GPU underutilized, and the cost of building the mask can offset the attention that is skipped [8], [15]. A method that reports FLOP reduction without measuring time has not shown that the idea is practical.

BlockSkip addresses these challenges with a deliberately small design. It partitions queries and keys into blocks of 64 tokens and computes one mean vector per block. For each pair, it takes the absolute dot product of the two means, normalized by the square root of the head dimension, and skips the pair when the score is below τ = 10^-3 (Section 3). This single scorer addresses the first challenge by replacing per-token scoring with per-block statistics; the block structure also yields a contiguous mask that a block-sparse kernel can execute [2]. To address the second challenge, we keep one global threshold and evaluate it directly rather than tuning it per layer, so the experiments reveal whether a single operating point transfers. To address the third, we measure inference time rather than only counting skipped blocks [15], and we compare against dense attention and token-level pruning on LongBench with a 7B model (Section 4).

We summarise our contributions as follows. First, we propose BlockSkip, a training-free block-level skipping method that uses block means and a single threshold to decide which (query block, key block) pairs to compute (Section 3). Second, we provide a preliminary evaluation on LongBench with a 7B model, comparing BlockSkip with dense attention and token-level pruning under the same accuracy and timing protocol (Section 4). Third, in our current experiments, BlockSkip reaches 71.2 accuracy against 70.4 for dense attention and reduces inference time by 31% (1.45x speedup), while token pruning reaches 69.1 accuracy and 1.04x speedup (Section 4).

## References

[1] Y. Bai, X. Lv, J. Zhang, et al., "LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding," ACL, 2024.

[2] T. Dao, D. Y. Fu, S. Ermon, et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness," NeurIPS, 2022.

[3] I. Beltagy, M. E. Peters, A. Cohan, "Longformer: The Long-Document Transformer," arXiv:2004.05150, 2020.

[4] M. Zaheer, G. Guruganesh, A. Dubey, et al., "Big Bird: Transformers for Longer Sequences," NeurIPS, 2020.

[5] N. F. Liu, K. Lin, J. Hewitt, et al., "Lost in the Middle: How Language Models Use Long Contexts," TACL, 2023.

[6] Z. Zhang, Y. Sheng, T. Zhou, et al., "H2O: Heavy-Hitter Oracle for Efficient Generative Inference of Large Language Models," NeurIPS, 2023.

[7] L. Ribar, I. Chelombiev, L. Hudlass-Galley, et al., "SparQ Attention: Bandwidth-Efficient LLM Inference," ICML, 2024.

[8] J. Yuan, H. Gao, D. Dai, et al., "Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention," ACL, 2025.

[9] G. Xiao, J. Tang, J. Zuo, et al., "DuoAttention: Efficient Long-Context LLM Inference with Retrieval and Streaming Heads," ICLR, 2025.

[10] H. Jiang, Y. Li, C. Zhang, et al., "MInference 1.0: Accelerating Pre-filling for Long-Context LLMs via Dynamic Sparse Attention," NeurIPS, 2024.

[11] J. Tang, Y. Zhao, K. Zhu, et al., "Quest: Query-Aware Sparsity for Efficient Long-Context LLM Inference," ICML, 2024.

[12] R. Xu, G. Xiao, H. Huang, et al., "XAttention: Block Sparse Attention with Antidiagonal Scoring," ICML, 2025.

[13] E. Lu, Z. Jiang, J. Liu, et al., "MoBA: Mixture of Block Attention for Long-Context LLMs," NeurIPS, 2025.

[14] C. Xiao, P. Zhang, X. Han, et al., "InfLLM: Training-Free Long-Context Extrapolation for LLMs with an Efficient Context Memory," NeurIPS, 2024.

[15] D. Ohayon, I. Lamprecht, I. Hubara, et al., "Block Sparse Flash Attention," NeurIPS, 2026.

Two items need confirmation: whether the 1.45x is end-to-end wall-clock time (and on which GPU, batch size, and sequence length), and which 7B model was used. The accuracy difference comes from a single run, so the 0.8-point gain should be described as preliminary until variance is measured.

这是 AI 写的引言，事实、数字和引用请你逐条核对。

## 卡片提醒

- **W01** 先把贡献写成一到三条：这版引言把贡献压成三条。
- **E02** 证据先于叙事：数字都标了 preliminary，没有再把 0.8 个点说成「显著」。
- **W04** 读者优先：先给问题再给方法，术语前后一致。

> 引言按 six-paragraph 走，但把摘要的「显著超过现有稀疏方法」收窄成「block mean 够不够」的实证问题：intro-drafter 的 evidence-discipline 要求数字有出处，而稿子只有一张表、只跑了一次，1.45x 也没写测量口径；你 10-26 记下的「先对齐阶段、块粒度和基线」正好说明为什么不能拿它和 MInference 的 10x 比。
> **引言里的每个数字都要有实验出处；没有出处就降级成问题，不要降级成形容词。**
> 下次先确认 1.45x 是端到端还是 kernel，再决定引言里要不要写这个数。
> ▸ 决策：把 BlockSkip 引言收窄成「block mean 够不够」的实证问题，放弃「显著超过现有稀疏方法」的框架（我定的）

`paper/` 没动；完整版和这次的记录写进了 `.duck/reports/2026-10-26-intro.md`、`.duck/notebook.md` 和 `.duck/decisions.md`。

</details>

## write: `/duck-write 写方法一节，依据 code/skip_attn.py 和 paper/main.tex。先在对话里给草稿，paper/ 里的文件先别改。` (227s)

- [x] must: read library/paper-writer
- [x] must: wrote a write report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number
- [x] must: reminds the student to check facts, numbers and citations
- [x] should: notices the method text and the code disagree
- [x] should: paper/main.tex untouched

<details><summary>reply</summary>

## 3. Method

### 3.1 Overview

BlockSkip is a block-level sparse attention procedure with three parts: a block partition, a mean-similarity scorer that produces a binary block mask, and a sparse attention computation over the selected blocks. It takes query, key, and value matrices $Q, K, V \in \mathbb{R}^{N \times d}$ and a block size $B$, and returns an output $O \in \mathbb{R}^{N \times d}$. Block-wise computation is the basis of IO-aware attention [1], and sparse attention reduces the number of query-key pairs that are computed [2], [3]. The procedure is training-free: the mask is computed from the current inputs, and no parameters are added or updated. We describe the scorer and mask in Section 3.2, the attention computation in Section 3.3, and the cost and implementation in Section 3.4.

### 3.2 Block-Level Scoring

We partition the sequence into $n = N/B$ blocks of $B = 64$ tokens; for clarity, we assume $N$ is a multiple of $B$. For block $i$, let $\mathcal{B}_i$ denote its token positions, and let $Q_i \in \mathbb{R}^{B \times d}$ and $K_j \in \mathbb{R}^{B \times d}$ be the query and key rows in blocks $i$ and $j$. We summarize each block by its mean vector:

$$
\bar q_i = \frac{1}{B} \sum_{t \in \mathcal{B}_i} q_t, \qquad
\bar k_j = \frac{1}{B} \sum_{t \in \mathcal{B}_j} k_t,
$$

where $q_t$ and $k_t$ are the query and key rows at position $t$. We score every block pair $(i,j)$ by the absolute dot product of the two means, scaled by $\sqrt{d}$:

$$
s_{ij} = \frac{|\bar q_i^\top \bar k_j|}{\sqrt{d}}.
$$

The pair is retained when $s_{ij} > \tau$, with $\tau = 10^{-3}$ in all experiments, and skipped otherwise. The resulting mask is $M_{ij} = \mathbb{1}[s_{ij} > \tau]$. The score is a proxy for block importance, not a normalized attention mass: it measures whether the two block means point in similar directions and can be computed before any token-level query-key product. The scorer is deliberately cheap: it replaces per-token scoring with one mean vector per block, so its cost is paid once per block rather than once per token. We use a single global threshold across layers and heads; Section 4 reports whether this operating point transfers. Unlike methods that fix the sparse pattern before inference, such as Longformer [2] and BigBird [3], BlockSkip computes the mask from the current block means rather than from a predefined pattern.

### 3.3 Sparse Attention Computation

For a query block $i$, let $\mathcal{S}_i = \{j : M_{ij} = 1\}$ be the retained key blocks, and let $\mathcal{C}_i = \bigcup_{j \in \mathcal{S}_i} \mathcal{B}_j$ be the corresponding key positions. We compute attention only over $\mathcal{C}_i$:

$$
o_t = \sum_{u \in \mathcal{C}_i}
\frac{\exp(q_t^\top k_u / \sqrt{d})}
{\sum_{v \in \mathcal{C}_i} \exp(q_t^\top k_v / \sqrt{d})} v_u,
\qquad t \in \mathcal{B}_i.
$$

The denominator is taken over the retained positions, so skipped blocks do not contribute to the softmax normalization. This is an approximation to full attention: both the numerator and the denominator exclude the skipped blocks, and the output is renormalized over the retained set. If $\mathcal{S}_i$ is empty, the implementation falls back to the first key position so that every query receives a finite output.

### 3.4 Cost and Implementation

The scorer costs $O(n^2 d) = O(N^2 d / B^2)$ to compare all block pairs, plus $O(Nd)$ to compute the block means. The attention computation costs $O(\sum_i |\mathcal{C}_i| d) = O(N \bar{k} B d)$, where $\bar{k}$ is the average number of retained blocks per query block. When $\bar{k} B \ll N$, the attention term is linear in $N$ for fixed $\bar{k}$ and $B$, rather than quadratic. The mask itself has $n^2$ entries and is materialized before the attention loop. Our reference implementation follows this procedure directly: it builds the mask, gathers the retained key and value rows for each query block, and computes the softmax over the gathered rows. It is written for clarity rather than throughput; a throughput-oriented implementation would fuse the scoring and the sparse attention and avoid materializing the gathered rows. The analysis also shows where the speedup can fail: if the scorer or the gather dominates, skipping blocks does not reduce wall-clock time.

## References

[1] T. Dao, D. Y. Fu, S. Ermon, et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness," NeurIPS, 2022.

[2] I. Beltagy, M. E. Peters, A. Cohan, "Longformer: The Long-Document Transformer," arXiv:2004.05150, 2020.

[3] M. Zaheer, G. Guruganesh, A. Dubey, et al., "Big Bird: Transformers for Longer Sequences," NeurIPS, 2020.

Change "attention mass" in the Method section to "mean similarity": the code computes an absolute dot product of block means, not a softmax mass. The code also has no causal mask and truncates the final partial block when $N$ is not a multiple of 64; add a causal block mask and handle the remainder before submission. The repository contains a NumPy reference implementation, so please state which implementation produced the 1.45x timing; the three citations here are numbered locally and should be renumbered when merged.

这是 AI 写的正文，事实、数字和引用请你逐条核对；会议或学校要求披露 AI 使用的，照要求披露。

## 卡片提醒

- **W01** 先把贡献写成一到三条：方法节要能对上引言那三条贡献。
- **E02** 证据先于叙事：方法节按代码的实际计算写，没有照摘要的「attention mass」写。
- **W04** 读者优先：公式之间用文字隔开，符号前后一致。

> 方法节按代码的实际计算写，没有把 paper 里的「attention mass」照抄成公式：paper-writer 的 section-guidance 要求方法节能被另一个人复现，而代码算的是 block 均值的绝对值点积，softmax 只在选中的列上归一化；照摘要写就会和代码对不上。
> 你 10-26 记下的「先补逻辑链，再改句子」在这里也成立：方法节的链是 mask → gather → softmax，不是「估 attention mass」。
> **方法节写代码实际做了什么，不写摘要希望它做什么。**
> 下次先把代码里的 causal mask、softmax 分母、fallback 逐项对照方法节，再写公式。
> ▸ 决策：按代码的实际计算写，保留「无 causal mask / 只在选中列上归一化」两个限制，放弃把方法写成 full attention 的精确近似（我定的）

`paper/` 没动；完整版和这次的记录写进了 `.duck/reports/2026-10-26-write.md`、`.duck/notebook.md` 和 `.duck/decisions.md`。

</details>

## figure: `/duck-figure 给 notes.md 里的速度和准确率结果设计一张主图。` (106s)

- [x] must: read library/figure-designer
- [x] must: wrote a figure report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number

<details><summary>reply</summary>

## 1. Figure type

- **Type**: experimental-results
- **Reason**: 这张图要回答「BlockSkip 是否同时更快、更准」，属于 efficiency-effectiveness trade-off，不是 motivating example，也不是 pipeline。

## 2. Paradigm recommendation

- **Paradigm**: trade-off scatter（x = speedup，y = accuracy，三个方法各一点，直接标注方法名）
- **Why this paradigm**: 三个方法只有两个数（准确率、加速），scatter 把两个量放在同一张图上，读者一眼能看到 BlockSkip 在右上角，token pruning 在右下、dense 在左下。它还能直接画出「比 dense 更快且更准」的象限，不需要双轴。
- **Alternatives considered and rejected**:
  - **双轴柱状图**：左右两个 y 轴会让人误以为两根柱子可以直接比高矮，而且 0.8 个点和 0.45× 会被压成两组独立的柱子，trade-off 消失。
  - **分组柱状图（两个 panel）**：信息完整，但读者要在两个 panel 之间来回看，主图的一句话结论会被拆散。
  - **折线图**：只有三个离散方法，没有连续的 x 变量；连线会暗示方法之间有一个不存在的顺序。
  - **直接放表格**：Table 1 已经有这三个数，图应该展示 trade-off，而不是重复表格。

## 3. Layout sketch

- **Canvas**: 单栏，3.3 in × 2.4 in（约 238 × 173 pt），插入时保持 3.3 in 宽，不再缩小。
- **Panels**: 一个 axes 占满画布，左边距 0.18、右边距 0.04、下边距 0.17、上边距 0.06。
- **Axes**:
  - x 轴：0.95 到 1.55，刻度 1.0、1.1、1.2、1.3、1.4、1.5；在 x = 1.0 画一条浅灰虚线，标 `dense baseline`。
  - y 轴：68 到 72，刻度 68、69、70、71、72；在 y = 70.4 画一条极浅的灰虚线，标 `dense accuracy`。
- **Points**:
  - Dense attention: (1.00, 70.4)，灰色圆点，s = 60。
  - Token pruning: (1.04, 69.1)，橙色方点，s = 60。
  - BlockSkip (ours): (1.45, 71.2)，蓝色星形，s = 180，黑色描边 0.6 pt，放在最上层。
- **Arrows and connections**: 从 dense 点到 BlockSkip 点画一条浅灰箭头，箭头旁标 `faster and more accurate`；不要画从 dense 到 token pruning 的箭头，避免暗示 token pruning 是主线。
- **Annotations**:
  - 每个点用偏移标注，避免 1.00 和 1.04 两个点挤在一起：`Dense 1.00×, 70.4` 标在点左下方；`Token pruning 1.04×, 69.1` 标在点上方；`BlockSkip 1.45×, 71.2` 标在点左上方。
  - 右上角象限用极浅蓝底（alpha 0.06）标出 `better`。
  - 右下角小字：`Single run; no error bars.`，8 pt，灰色。
  - 不要在图上放标题，标题交给 caption。
- **Colour assignment**: dense = #7F7F7F（灰），token pruning = #E69F00（橙），BlockSkip = #0072B2（蓝），来自 Okabe-Ito 色盲安全盘；形状同时区分，黑白打印也能读。

## 4. Labelling and annotations

- **Element names**: `Dense attention`, `Token pruning`, `BlockSkip (ours)`；轴名 `Speedup over dense attention (×)` 和 `LongBench accuracy (reported score)`。
- **Critical highlights**: BlockSkip 的星形加大、加黑边；右上角标 `better`；token pruning 的点不要加高亮，让读者看到它更慢也更不准。
- **Font sizes**: 轴标签 9 pt，刻度 8 pt，点标注 8 pt，角标 8 pt；最终插入宽度下不低于 8 pt。
- **Colour palette**: Okabe-Ito（灰、橙、蓝），色盲安全；同时用圆、方、星三种 marker 做双重编码。

## 5. Tool suggestion

- **Primary**: Matplotlib，输出 PDF，复用 `plot_utils.py` 里的字体、线宽、palette。
- **Alternative**: PGFPlots（如果整篇论文要求 LaTeX 原生图）。
- **Reason**: 三个点的 scatter 用 Matplotlib 足够，脚本可复现；不要用 Excel 或手改 Illustrator。

## 6. Universal rule audit

- [x] Vector format: pass（`savefig("fig1.pdf")`；不嵌 PNG）。
- [x] Font size: pass（按 3.3 in 插入设计，最小 8 pt；如果缩到 3.0 in 会低于 8 pt，需重设）。
- [x] Colour-blind safe: pass（Okabe-Ito + 圆/方/星双重编码）。
- [x] Self-contained caption: pass（第一句给结论，轴有单位，方法名和 single-run 都在 caption 里）。
- [x] Honest axis range: pass（y 从 68 开始，不从 69 或 70 开始；x 从 0.95 开始，保留 1.0 参考线；没有截断顶部）。
- [x] No chartjunk: pass（无 3D、无渐变、无阴影、浅灰网格、无图内标题）。

text-only：没有提供成图，所以字体实际渲染、PDF 是否嵌位图、颜色在打印机上的表现这三项标为 **user must verify**。

## 7. Integrity gate result

- Gate 1 (paradigm matches type): pass（experimental results 的 trade-off 用 scatter）。
- Gate 2 (layout concrete enough): pass。
- Gate 3 (labels are real names): pass（三个方法名和轴名都是真的，没有 Module A）。
- Gate 4 (tool matches complexity): pass（三个点的 scatter 用 Matplotlib）。
- Gate 5 (universal audit run): pass；视-only 项标 user must verify。
- Gate 6 (motivated example loop): N/A。
- Gate 7 (chart type matches data type): pass（trade-off 用 scatter）。

## 8. Severity summary

- **0 CRITICAL, 2 MAJOR, 1 MINOR**。
- Top three actions first:
  1. **确认 1.45× 的口径**：如果它是 attention-only，x 轴改成 `Attention speedup (×)`，caption 里不要写 inference speed；如果是端到端，写 `End-to-end speedup (×)`。这是 MAJOR，因为图的主结论依赖它。
  2. **补误差棒或明确写 single run**。notes 里写「只跑了一次」，图注已经标了 `Single run; no error bars.`；如果能补 3 个种子，把点换成均值 ± 标准差，图会强很多。这是 MAJOR。
  3. **确认 7B 模型名和 LongBench 的平均口径**，写进 caption；现在图注只能写 `a 7B model` 和 `reported score`。这是 MINOR。

## Caption draft

**Figure 1: BlockSkip is the only configuration among the three shown that improves both accuracy and speed over dense attention, although the 0.8-point accuracy gain comes from a single run.** Points report LongBench accuracy and the speedup values in the draft: dense attention 1.00× and 70.4, token pruning 1.04× and 69.1, BlockSkip 1.45× and 71.2. The draft does not specify whether speedup is end-to-end or attention-only, and each configuration was run once, so no error bars are shown. The y-axis starts at 68 to keep the 69.1 to 71.2 range visible; it is not a zero-based axis.

## 卡片提醒

- **E05** 差距要大过种子间的波动：notes 只跑了一次，图上必须标 single run。
- **E02** 证据先于叙事：caption 第一句给结论，但没有把 0.8 个点说成「显著」。
- **W04** 读者优先：直接标注方法名和数值，不靠图例来回查。

> notes 只有三个点和一次运行，所以选 trade-off scatter 而不是双轴柱状图：双轴会把 0.8 个点的准确率差和 0.45× 的加速差压成两组独立的柱子，读者看不到 BlockSkip 是唯一在右上角的点；你 10-26 记下的「先对齐阶段、块粒度和基线」也要求 caption 写清 1.45× 的口径。
> **主图先画 trade-off，再画单项排名；两个量放在同一张图上，读者才能看到谁在右上角。**
> 下次先确认 speedup 是端到端还是 attention-only，再决定 x 轴标签和 caption。
> ▸ 决策：选 accuracy-speedup scatter，放弃双轴柱状图和分组柱状图（我定的）

`paper/` 没动；完整版写进了 `.duck/reports/2026-10-26-figure.md`，原则和决策也记进了 `.duck/notebook.md` 和 `.duck/decisions.md`。

</details>

## vibe: `/duck-vibe 下周要在 LongBench 上把 BlockSkip 全量跑一遍、补三个随机种子，再写实验一节。哪些交给 AI 做、做到哪一步、哪些我自己把关？` (134s)

- [x] must: read library/vibe-research-workflow
- [x] must: wrote a vibe report
- [x] should: reply has the why block
- [x] should: shows a card reminder with a plugin card number

<details><summary>reply</summary>

notes 里写的是 10-30 截稿，今天是 10-26；如果你说的「下周」是字面意思，就会撞线。下面按 10-26 到 10-30 四天排；如果截稿已经延后，把同样的块平移到下周。

一句话分工：**AI 负责把正确性测试、LongBench harness、9 次运行、聚合和实验节草稿做出来；它停在第一个失败测试、第一个 baseline 对不上、claim skeleton 和最终稿。你负责协议、causal / softmax / padding / GQA 的正确性、哪些 run 算数、结论和最终文字。**

## 1. Phase

- **Primary phase**: mixed（coding + writing）
- **Secondary phases**: analysis, figure
- **Feasibility note**: 全量 LongBench × 3 个方法 × 3 个 seed 是 9 次运行。先测第一次 full run 的 wall-clock；如果一次超过 4 小时，9 次在 10-29 前跑不完，必须改成「全量 21 任务 × 1 seed + 6 任务分层子集 × 3 seeds」，并在论文里写清缩小后的范围。这个决定你来做，不要让 AI 悄悄换任务集。

## 2. Behavioural rules recap

1. AI 可以做：代码脚手架、调试、跑实验、语言润色、格式化引用。
2. 必须你自己拥有：研究问题、实验设计、模型与任务选择、加速口径、baseline 是否公平、核心结论、novelty。
3. 每段 AI 代码你要逐行读并跑测试；每段 AI 文字你要逐句核对，数字要能追到 run log。
4. 引用必须来自你自己的阅读和确认；AI 不能编 paper、作者、venue 或 BibTeX。
5. 不能编数据、补缺失的 seed、把 failed run 写成成功。
6. 查 workshop 的 AI 使用与披露政策，按要求披露。

## 3. Workflow plan

| Time block | Phase | AI does → stops at | Tool | You own / gate |
|---|---|---|---|---|
| Mon 10-26 AM | Coding | 读 `code/skip_attn.py` 和 `paper/main.tex`，写出 model-level wrapper 的计划；停在计划，不写代码。 | Claude Code / Codex | 定协议：模型名、LongBench 任务与 metric、加速口径（prefill / decode / end-to-end）、baseline 定义。确认 1.45× 是哪套实现跑出来的；NumPy 参考实现不可能是来源。 |
| Mon 10-26 PM | Coding | 实现 causal block mask、padding、GQA-aware wrapper 和单元测试（τ=-1 时对齐 dense；改未来 token 不影响过去输出；N 不能被 64 整除时怎么处理）；停在第一个失败的测试。 | Claude Code / Codex | 逐行审 causal 设计；决定 query block 的均值能不能包含块内未来 token；批准测试通过标准。custom CUDA kernel 本周不做，先用 SDPA / FlexAttention + block mask，测到什么报什么。 |
| Tue 10-27 AM | Coding | 接进 LongBench harness，在 3 个任务的子集上跑 dense，写 manifest；dense 对不上 70.4 就停。 | Claude Code / Codex | 看第一份 log 和 manifest；决定 3 任务子集是否有代表性；确认 dense 的 tolerance。 |
| Tue 10-27 PM | Coding | 实现 token-pruning baseline，在同一子集上跑；对不上 69.1 / 1.04× 就停并解释差异。 | Claude Code / Codex | 决定这个 baseline 是否公平；不公平就换。测第一次 full run 的 wall-clock，决定 9 次运行是全量 21 任务还是 6 任务分层子集。 |
| Wed 10-28 | Coding / experiment | 跑 3 个方法 × 3 个 seed 的 LongBench，每次一个 manifest；OOM / NaN 直接报错停，不静默重试。 | Claude Code / Codex + GPU | 第一跑之前冻结 config；随机抽查 log；决定哪些 run 算数、哪些要排除，排除规则先写下来。 |
| Thu 10-29 AM | Analysis | 聚合 mean / std / bootstrap CI，生成表和图，写 `results/summary.csv`。 | Python + Matplotlib | 对着 raw log 核聚合；决定误差棒是 seed 间波动还是样本 bootstrap CI。 |
| Thu 10-29 PM | Writing | 从 `summary.csv` 起草实验节；停在 claim skeleton，不写结论句。 | Claude / ChatGPT + Overleaf | 先自己写 topic sentence 和结论；再让 AI 展开；逐句核对每个数字。 |
| Fri 10-30 AM | Writing / integrity | 跑 banned-pattern 扫描、查 cross-reference、排表格；停在最终稿。 | Claude / Overleaf | 最后通读；确认 AI 披露；提交。 |

## 4. Tool recommendations

| Phase | Primary tool | Alternative | Reason |
|---|---|---|---|
| Coding | Claude Code | Codex / Cursor | agentic CLI 能读 repo、跑测试、按 plan 小步改；项目是 Python/NumPy，不需要 IDE 特有功能。 |
| Experiment tracking | `results/` CSV + `run_manifest.json` | W&B | 每次 run 一个 manifest，记录 model、task、seed、block size、τ、speedup scope、GPU、commit；不依赖云。 |
| Writing | 你自己写 skeleton，Claude 润色 | ChatGPT | claim 和结论必须是你自己的；AI 只做语言和结构。 |
| Figure | Matplotlib | PGFPlots | trade-off 图从 `summary.csv` 生成，复用 `plot_utils.py`。 |

## 5. Red-line reminders

- **不让 AI 编数字**：71.2、70.4、69.1、1.45×、1.04× 都必须来自新的 run log；缺的格子写 `--`，不要插值。
- **不让 AI 静默改 config**：block size、τ、模型、任务、加速口径，任何一项变了就新建 manifest；failed run 保留，不覆盖。
- **不让 AI 选协议**：模型、LongBench 任务、metric、speedup 口径、baseline 公平性，都是你的判断。
- **不让 AI 写 claim**：实验节的 topic sentence、结论、limitation 你先写；AI 只能从 `summary.csv` 展开。
- **不做 3-seed 表演**：先定义 seed 控制什么。如果推理是确定性的，3 个 seed 会得到同一个数；这时真正的不确定性是 LongBench 样本上的 bootstrap CI。如果 harness 有随机性，报 mean ± std。你决定论文报哪种。
- **不编引用**：related work 的引用你自己读、自己确认；AI 只排版。
- 按 workshop 政策披露 AI 使用。

## 6. Integrity gate plan

- **Verification points**:
  - 单元测试：τ=-1 对齐 dense；未来 token 不影响过去；N 不整除 64；GQA 分组。
  - dense baseline 在 3 任务子集上复现 70.4（容差先写下来）。
  - 每次 run 有 manifest；raw log 保留；排除规则写在跑之前。
  - 聚合结果能从 raw log 重算；图和表从同一份 `summary.csv` 生成。
  - 实验节每个数字能追到 manifest；每句话你逐句核对。
  - 引用逐条确认；AI 不生成 BibTeX。
- **AI-disclosure requirements for the target venue**: 先查 workshop 的 policy；如果需要披露，写「AI assisted with code scaffolding, experiment automation, and language polishing; the author verified all code, results, and text.」具体措辞按 venue 要求。

## 卡片提醒

- **E01** 用最小的实验最快降低不确定性：第一天先跑 3 任务子集和 τ=-1 对齐 dense，不直接全量。
- **E05** 差距要大过种子间的波动：先定义 seed 控制什么；确定性推理用 bootstrap CI，不要用 3 次相同结果造误差棒。
- **E02** 证据先于叙事：实验节从 `summary.csv` 写，不从旧的 Table 1 写。

> notes 里的 10-30 截稿和「下周」冲突，所以按 10-26 到 10-30 四天压缩排；`code/skip_attn.py` 还是没有 causal mask 的 NumPy 参考实现，直接拿去跑 7B LongBench 会先把未来 token 漏进来，所以第一道 gate 是 correctness，不是 3 seeds。
> 你 10-26 记下的「方法节写代码实际做了什么」和「先对齐阶段、块粒度和基线」都指向同一件事：先把 wrapper 和 dense baseline 对平，再谈全量。
> **先把正确性和基线跑通，再让 AI 跑规模；AI 可以写代码和跑实验，但不能替你定义什么叫「跑通」。**
> 下次先写一张 pre-flight 清单（causal mask、softmax 分母、padding、GQA、dense baseline、speedup 口径），再让 AI 动手。
> ▸ 决策：把四天里的第一天全部给 correctness gate，放弃「今天就开始全量」的排法（我定的）

完整版写进了 `.duck/reports/2026-10-26-vibe.md`，原则和决策也记进了 `.duck/notebook.md` 和 `.duck/decisions.md`。

</details>

## notes: `/duck-notes` (24s)

- [x] must: lists every stage in the notebook
- [x] must: notebook untouched

<details><summary>reply</summary>

笔记本现在有 6 条，都在 10-26，按阶段分组如下：

| 阶段 | 日期 | 原则（出处） | 这次 |
|---|---|---|---|
| 摸方向 | 10-26 | 比较稀疏注意力先对齐阶段、块粒度和基线（NSA §2.1；E02） | Quest 报 2.23x attention 加速却写 7.03x 端到端，MInference 的 10x 只算 prefill |
| 理逻辑 | 10-26 | 先补逻辑链，再改句子；一条主张没有对应的挑战和模块，就不要写进摘要（tech-paper-template Step 3；E02） | BlockSkip 摘要说显著超过现有稀疏方法，实验只比了 dense 和 token pruning |
| 写引言 | 10-26 | 引言里的每个数字都要有实验出处；没有出处就降级成问题，不要降级成形容词（intro-drafter evidence-discipline；E02） | BlockSkip 的 1.45x 没写测量口径，引言只能写成 preliminary |
| 写正文 | 10-26 | 方法节写代码实际做了什么，不写摘要希望它做什么（paper-writer section-guidance；E02） | BlockSkip 代码没有 causal mask，softmax 只在选中列上归一化，方法节按代码写 |
| 作图 | 10-26 | 主图先画 trade-off，再画单项排名；两个量放在同一张图上，读者才能看到谁在右上角（figure-designer experimental-results；E05） | notes 只有三个点和一次运行，BlockSkip 的 1.45× 没写口径，图注只能标 single run |
| 分工 | 10-26 | 先把正确性和基线跑通，再让 AI 跑规模；AI 可以写代码和跑实验，但不能替你定义什么叫「跑通」（vibe-coding Plan Before Execute；E01） | BlockSkip 的 NumPy 参考实现没有 causal mask，10-30 截稿和「下周」冲突 |

暂时没有更早的条目。要加、改、删哪一条，直接说，我先把改动前后给你看，你点头再动文件。

</details>

## notes-delete: `/duck-notes 删掉最后一条` (21s)

- [x] should: shows the change before writing

<details><summary>reply</summary>

改动前是 6 条，最后一条是分工这一条：

> - 10-26 分工｜先把正确性和基线跑通，再让 AI 跑规模；AI 可以写代码和跑实验，但不能替你定义什么叫「跑通」（vibe-coding Plan Before Execute；E01）｜这次：BlockSkip 的 NumPy 参考实现没有 causal mask，10-30 截稿和「下周」冲突

改动后将是 5 条，删掉上面这一条，最后一条变成作图那条：

> - 10-26 作图｜主图先画 trade-off，再画单项排名；两个量放在同一张图上，读者才能看到谁在右上角（figure-designer experimental-results；E05）｜这次：notes 只有三个点和一次运行，BlockSkip 的 1.45× 没写口径，图注只能标 single run

确认删这条吗？你点头我再改文件。

</details>

## notes-ok: `可以，删吧。` (44s)

- [x] must: the last line is gone and the rest kept

<details><summary>reply</summary>

已删除。笔记本现在共有 5 条，最后一条是「10-26 作图」。

你在 `decisions.md` 中留下的对应决策没有改动；如果你想把它也一起删掉，告诉我一声即可。

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
