# 方向背景：长上下文稀疏注意力

## 代表作

- Block Sparse Flash Attention（Ohayon 等，NeurIPS 2026）：按块 max 分数和校准阈值跳块，Llama-3.1-8B 上 LongBench 1.13x，接五个稀疏基线，https://neurips.cc/virtual/2026/loc/sydney/poster/155122
- MInference 1.0（Jiang 等，NeurIPS 2024）：预填充阶段用 A-shape、Vertical-Slash、Block-Sparse 三种模式加 GPU kernel，最高 10x，https://arxiv.org/abs/2407.02490
- Quest（Tang 等，ICML 2024）：按 query 估 KV page 的 criticality，只加载 top-k page，attention 最高 2.23x，https://arxiv.org/abs/2406.10774
- SparQ Attention（Ribar 等，ICML 2024）：用 query 的 top-r 分量近似分数，选择性取 KV，带宽最多省 8x，https://arxiv.org/abs/2312.04985

## 常用数据集和评测

- LongBench（Bai 等，ACL 2024）：21 个数据集、6 类任务，中英双语长文本，https://arxiv.org/abs/2308.14508
- RULER（Hsieh 等，COLM 2024）：长度和难度可配的合成长上下文评测，https://arxiv.org/abs/2404.06654
- Needle-in-a-Haystack：通常作为 RULER 的一个子任务，没查到单独的论文链接

## 还没定论的问题

- 块重要性估计器能不能比 max / min-max bound 更便宜还不掉点，均值、采样、学习各能走到哪。
- 端到端加速里 kernel 和稀疏各占多少，不同长度和 batch 下的拐点在哪。
- 高跳过率下哪类任务先坏，多文档 QA 和需要分散注意力的任务是不是最先掉。
- 固定阈值能不能跨层跨头，还是必须 per-head 校准。
