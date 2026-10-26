# 方向背景：块稀疏注意力用于长文本推理

- 代表作：MInference 1.0，按 head 选稀疏图案，1M prefill 最多 10×；[arXiv](https://arxiv.org/abs/2407.02490)
- 代表作：Quest，query-aware page 选择，32K self-attention 7.03×；[arXiv](https://arxiv.org/abs/2406.10774)
- 代表作：NSA，可训练的分层 block 稀疏，64K decode 11.6×；[arXiv](https://arxiv.org/abs/2502.11089)
- 代表作：MoBA，MoE 式块路由，1M prefill 6.5×；[arXiv](https://arxiv.org/abs/2502.13189)
- 代表作：MSA，GQA group 级 index branch，1M 上 14.2× prefill、7.6× decode；[arXiv](https://arxiv.org/abs/2606.13392)
- 常用评测：RULER 的 13 个任务，含 retrieval、multi-hop、aggregation；[arXiv](https://arxiv.org/abs/2404.06654)
- 常用评测：LongBench 的多任务长文本基准；[arXiv](https://arxiv.org/abs/2308.14508)
- 常用评测：∞Bench 的平均长度超过 100K；[arXiv](https://arxiv.org/abs/2402.13718)
- 还没定论：选择开销怎么在 FLOPs、kernel、端到端三层统一报告，常规 block selection 仍是 O(N²/C)；[PISA](https://arxiv.org/abs/2609.31093)
- 还没定论：GQA 下 head 级选择与 group 级选择哪个更划算，Quest 的证据在 MHA 上，MSA 用 group 级；[MSA](https://arxiv.org/abs/2606.13392)
- 还没定论：学习 indexer 与 per-head 自适应块大小能否组合，AB-Sparse 证明粒度重要，但还没有和学习的 indexer 合起来；[AB-Sparse](https://arxiv.org/abs/2605.12110)
- 还没定论：跨块聚合任务的失守点在哪里，RULER 的 aggregation 分项在 MSA 上已经出现 -1.35；[RULER](https://arxiv.org/abs/2404.06654)
