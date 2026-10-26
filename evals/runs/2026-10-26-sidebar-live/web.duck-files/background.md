# 方向背景：长上下文的块级稀疏注意力

## 代表作

- Sparse Transformer（Child 等，2019）：块稀疏的起点，说明去掉大部分 attention 连接仍可训练。https://arxiv.org/abs/1904.10509
- Quest（Tang 等，ICML 2024）：按页维护 min/max 元数据给 KV 页估关键性，只加载 top-k 页，报 2.23 倍自注意力加速。https://arxiv.org/abs/2406.10774
- MInference 1.0（Jiang 等，NeurIPS 2024）：免训练的动态稀疏 prefill 加 GPU kernel，1M token 上最多 10 倍延迟下降。https://arxiv.org/abs/2407.02490
- MoBA（Lu 等，2025）：块均值打分加 top-k 路由，块打分是 q 与块内 K 均值的点积（式 6），与本次想法机制重合。https://arxiv.org/abs/2502.13189
- NSA（Yuan 等，2025）：可训练稀疏注意力，粗粒度压缩加细粒度选择，64k 长度上报加速。https://arxiv.org/abs/2502.11089
- XAttention（Xu 等，2025）：用反对角线求和给块打分再选块。https://arxiv.org/abs/2503.16428

## 常用数据集和评测

- LongBench（Bai 等，2023）：中英双语多任务长上下文评测，含单文档问答、多文档问答、摘要、检索等子集。https://arxiv.org/abs/2308.14508
- RULER（Hsieh 等，2024）：可调长度的合成任务，测真实有效上下文长度。https://arxiv.org/abs/2404.06654
- 速度侧通常报 prefill 延迟、端到端延迟、自注意力加速比，并区分 8k、32k、128k 长度。

## 还没定论的问题

- 免训练稀疏在 8k 到 16k 这个 LongBench 常见长度上，真实 wall-clock 收益是多少：多数论文在 64k 到 1M 上报数，短长度上注意力占比本来就低。
- 块级估计器的质量与开销怎么权衡：均值、min-max、学习门控各有实现，缺少同一预算下的召回率对比。
- 哪类任务最先掉点：检索类（passage retrieval）和需要精确位置的子任务最可能被整块跳过伤到，公开的逐子任务失败分析不多。
