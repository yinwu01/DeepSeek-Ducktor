# e2e dsh 0.2.1-rc.2 paper c4d0f11, Doctor Duck 345d618 ((profile default))

21/21 checks passed; must failed 0, should failed 0

Model requested: deepseek-flash. Tokens reported in the --json stream (agent steps only): {"inputTokens":71121,"outputTokens":94048,"cacheReadTokens":4955520,"cacheWriteTokens":0,"totalTokens":5120689}

## review: `/duck-review paper/main.tex` (522s)

- [x] must: not turned on: hook injected the idle note
- [x] must: read library/pre-submission-reviewer
- [x] must: wrote a review report
- [x] should: grades issues CRITICAL / MAJOR / MINOR
- [x] should: reply has the why block

<details><summary>reply</summary>

### Step 0: paradigm and venue

**Paradigm.** STEM / technical (long-context LLM inference systems). I weighted the Introduction chain, contribution-to-section mapping, baseline coverage, ablation-based attribution, and figure quality.

**Venue.** The file is built on `neurips_2025` with the `preprint` option; no target venue is stated in the file. Main text ends on p. 9; references begin on p. 10, so it fits the 9-page NeurIPS limit with no slack. The original does not compile; I compiled a copy with `subcaption` replaced by `caption` to separate compile errors from layout, and page/figure checks below are from that copy.

**Retrieval check.** Web search was available, so I ran the novelty and citation-completeness checks (metadata only). The closest uncovered work is [XAttention (Xu et al., ICML 2025)](https://icml.cc/virtual/2025/poster/45650); [InfLLM (Xiao et al., NeurIPS 2024)](https://neurips.cc/virtual/2024/poster/94480) is also uncited. The cited set otherwise covers MInference, FlexPrefill, SpargeAttn, SeerAttention, Native Sparse Attention, and MoBA.

**Integrity note (confirm before submitting).** The file says “Preprint. Under review.”, but a paper with the same title and the same four authors is in the ICML 2026 proceedings, PMLR 306:51649–51668 ([PMLR](https://proceedings.mlr.press/v306/ji26m.html)). If this file is being submitted as new work, resolve prior publication / dual submission first; if it is the arXiv or camera-ready version, update the template, footer, and checklist. I did not count this as a table finding because the intent is not stated in the file.

### Summary
- CRITICAL: 3
- MAJOR: 13
- MINOR: 17
- Top three fixes first: (1) fix the `subfigure` + `subcaption` preamble so the paper compiles; (2) correct Eq. (4) to `S̃ ≥ ln(τ·l̃) + m̃` and confirm the kernel uses it; (3) add a three-item contribution list at the end of the Introduction, each with a section pointer, then add the Relative Attention Score / block-size ablation and separate calibration from the InfiniteBench test set.

### Dimension 1: Macro logic

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | The Introduction ends with “We conduct comprehensive experiments ... to verify the effectiveness of our method” and never states a contribution list; no claim maps to a section number. | CRITICAL | End §1 with three numbered contributions, each one sentence and one pointer, e.g. “(1) 4-bit element-wise estimation (§3.2); (2) Relative Attention Score (§3.2); (3) CUDA selection kernel (§3.4, §4.4)”. |
| 2 | The Introduction has no problem-level challenges paragraph; it jumps from “they fail to achieve an satisfactory accuracy-efficiency trade-off” to “To minimize the additional overhead ... SALE uses 4-bit quantized query and key vectors”. | MAJOR | Insert one paragraph on the hard constraints (element-wise inspection costs as much as the attention it skips unless the estimator is cheaper; sink-local normalization is needed; block granularity trades error for sparsity), then map each to §3.2/§3.3. The chain is compressed rather than fully absent. |
| 3 | No running example: the 128K NIAH input first appears in §4.3 (“These samples are obtained by truncating a single 128K-length input from the Needle-In-A-Haystack task”), not in the Introduction or §3. | MAJOR | Introduce that 128K sample in §1 as the anchor, use it in Fig. 1 and the §3.2 walkthrough, and return to it in §4.3. |
| 4 | Eq. (4) is algebraically wrong: it states `S̃[i,j] ≥ ln(τ·l̃_i + m̃_i)`, but from Eq. (3), `P̃ ≥ τ` is equivalent to `S̃ ≥ m̃_i + ln(τ·l̃_i)`. Putting `m̃_i` inside the log changes the threshold for every row. | CRITICAL | Change to `S̃[i,j] ≥ ln(τ·l̃_i) + m̃_i` and verify the CUDA comparison uses the same expression; add a one-line derivation in the appendix. |
| 5 | Calibration and evaluation overlap: “We select five input samples from the Retrieve.KV task in InfiniteBench to perform calibration for SALE” (App. C), and Table 2 reports Retrieve.KV. | MAJOR | Calibrate on a disjoint task/corpus, or exclude the five samples and state it; report InfiniteBench with a held-out calibration set. Add a leakage check. |
| 6 | The core mechanism is not isolated: App. E only ablates QK quantization (“SALE w/o QK Quant”) and §4.4 only ablates per-head calibration; there is no All / -RAS comparison against a plain attention-score threshold, and no block-size sweep. | MAJOR | Add a table with All, -RAS (use the plain attention score), -4bit, and `b_q`/`b_k` in {32, 64, 128}; report accuracy and latency for each. |
| 7 | Unsupported causal claim: “We attribute this improvement to our method's ability to potentially filter noisy information ... thereby enhancing the model's comprehension capabilities.” No experiment separates noise filtering from calibration or sampling. | MAJOR | Present it as a hypothesis, or measure it (attention entropy / noisy-token recall); otherwise drop the causal clause and report the number without explanation. |
| 8 | Overclaim: the Conclusion says “the best trade-off among existing sparse attention baselines” and the Abstract says “outperforms existing approaches”, but only four baselines and two models are tested; on Llama LongBench the SALE average is 48.39 vs FA2 48.77. | MAJOR | Say “among the four baselines tested” and “best accuracy-efficiency trade-off on LongBench / InfiniteBench”; state the Llama average drop explicitly. |
| 9 | Related Work overgeneralizes: “All these methods fail to achieve accurate predictions due to their overly coarse-grained approximations of attention maps.” The closest block-sparse work, XAttention (Xu et al., ICML 2025), is not cited or compared; InfLLM (Xiao et al., NeurIPS 2024) is also missing. | MAJOR | Scope the claim to the cited line/block methods, add XAttention and InfLLM, and compare on the difference axis (antidiagonal scoring vs 4-bit element-wise estimation). |
| 10 | Table 2 repeats the Table 1 speedup row verbatim (“Speedup (64K) ... 3.36×”); Table 1's text says it is a 64K NIAH measurement, Table 2 does not. | MINOR | Label both rows “Speedup on 64K NIAH” or measure per benchmark; if the numbers are the same measurement, say so in the caption. |

### Dimension 2: Writing details

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | §1 paragraph 3 runs 13 source lines and covers the method, the CUDA kernel, and the 3.36× result: “In addition to our algorithm design, we introduce several kernel optimization techniques ... The results of the speed test show ...”. | MAJOR | Split into method overview, kernel, and results; give the kernel sentence its own topic sentence. |
| 2 | The Abstract has no challenge sentence: it goes from “these approaches typically perform coarse-grained inspection” straight to “In this paper, we propose SALE”. | MINOR | Add one sentence on why fine-grained inspection is hard (it costs as much as the attention it skips unless the estimator is cheaper). |
| 3 | Related Work ends with a one-sentence kernel paragraph, “Although these methods accelerate computation, they still require full attention calculations and fail to fully exploit the inherent sparsity of attention maps”, with no positioning of SALE. | MINOR | Add one closing sentence: SALE uses these kernels only for the selected blocks, not the full map. |
| 4 | Experiments open with settings (“Most of the experiments are conducted using Llama-3.1-8B-Instruct”) without stating the questions the section answers. | MINOR | Add a three-question roadmap (accuracy, speed, attribution) before Settings. |
| 5 | Repetition: “training-free” / “requires no parameter training” / “trivial code modifications” appear in the Abstract, Introduction, and Conclusion; “Qwen-2.5” and “Qwen2.5” are mixed. | MINOR | Keep one statement of each claim; pick one spelling of Qwen2.5. |
| 6 | Fairness is ambiguous: “we use the calibration samples for MInference, SpargeAttn, and SALE” is missing “same”. | MINOR | “we use the same calibration samples for ...”. |

### Dimension 3: English grammar

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | G1 articles: “an satisfactory accuracy-efficiency trade-off” (§1); “Most of LLMs adopt decoder-only Transformer architecture” (§1); “During evaluation process” (App. C); “in local area” (App. C). | MINOR | “a satisfactory”; “Most LLMs adopt a decoder-only Transformer architecture”; “During the evaluation process”; “in the local area”. |
| 2 | G2 agreement: “Let N represents the sequence length, and d represents the hidden size”, “the corresponding token at the offset i are q_i, k_i, v_i” (§3.1); “their publicly available implementation” (§4.1); “context-parallel technique” (§4.1). | MINOR | “Let N represent ... and d represent ...”; “the corresponding tokens ... are”; “implementations”; “techniques”. |
| 3 | G3 tense: Related Work uses present throughout (“Many previous works try”, “Some methods use”), where the guide asks for past for prior work; “the sparsity nature” is also Chinglish. | MINOR | “Many previous works tried”; “Some methods used”; “the sparse nature”. |
| 4 | G5 which/that: “we design a novel metric Relative Attention Score which reflects the relative magnitude” (§1) is restrictive. | MINOR | “... metric, Relative Attention Score, that reflects ...” (or add commas if non-restrictive). |

### Dimension 4: LaTeX format

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | The file does not compile: `\usepackage{subfigure}` (main.tex:26) and `\usepackage{subcaption}` (main.tex:27); pdflatex stops with “Package subcaption Error: This package can't be used in cooperation with the subfigure package” at `\subcaption@CheckCompatibility`. | CRITICAL | Remove `subcaption` and load `caption` (the file uses `\captionof` in Table 3), which compiles; or migrate every `\subfigure` to `subcaption` and re-check the labels. |
| 2 | Submission anonymity: `\usepackage[preprint]{neurips_2025}` (main.tex:3) with `\author{...}` (main.tex:39–43) prints “Preprint. Under review.” and the author names. | MAJOR | Use the default (anonymous) option for a double-blind submission; keep `preprint` only for the arXiv version. |
| 3 | The NeurIPS Paper Checklist is missing: the appendix has A Limitation, B Broader impact, C Additional implementation details, D Additional experiment details, E Additional ablation studies, but no checklist. | MAJOR | Add the required checklist after the references ([NeurIPS Paper Checklist](https://neurips.cc/public/guides/PaperChecklist)). |
| 4 | Four numbered equations, zero `\label`; Eq. (1) and Eq. (2) are never referenced in prose. | MINOR | Add labels and `\Cref`, or use `equation*` for equations that are not referenced. |
| 5 | Tables 1 and 2 mix booktabs rules with vertical bars in the tabular preamble. | MINOR | Drop the vertical rules and use `\cmidrule` for the Llama/Qwen grouping. |
| 6 | Title and section-title typos: “SALE :  Low-bit ...” has a space before the colon and a double space; “Related works” should be “Related Work”. | MINOR | “SALE: Low-bit ...”; “Related Work”. |
| 7 | `\typeout{get arXiv to do 4 passes: ...}` sits after `\end{document}` (main.tex:69) and is never executed. | MINOR | Remove it or move it before `\end{document}`. |

### Dimension 5: Figure quality

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| 1 | Figures 1 and 4 are scaled to 0.35, 0.30, and 0.225 (`\scalebox{0.35}`, `\scalebox{0.225}`); in the compiled PDF the tick labels and legends are unreadable at print size. | MAJOR | Redraw at final width (one-column or full-width), keep fonts at least 7–8 pt after scaling, and avoid `\scalebox` below about 0.8. |
| 2 | Figure 2 uses a red-green heatmap and the caption is only “Needle-In-A-Haystack evaluation results.”: no finding, no axis definition, no colorbar explanation. | MAJOR | Use a colorblind-safe scale (viridis/cividis), define Context Length / Depth Percent and the score colorbar, and start the caption with the takeaway (SALE keeps 96.0% average at 3.81×). |
| 3 | Figure 3 caption has “SALE v.s. SALE w/o Calibration” and the x-label “128K Latency(s)” lacks a space and a unit convention. | MINOR | “SALE vs. SALE w/o Calibration”; “Latency (s) at 128K”. |
| 4 | Table captions state setup only: “Latency breakdown (ms).” and “LongBench evaluation results ... boldface ... underline ...”; no takeaway. | MINOR | Add one finding per caption (e.g., “Overhead falls from 23.9% at 8K to 11.1% at 128K while Computation-Pass speedup rises to 6.87×”). |

### Banned-vocabulary and em-dash scan

Scope: full scan of all 16 `.tex` files (main, abstract, intro, related work, three method files, six experiment files, conclusion, appendix, algorithm), no sampling.

- **MAJOR: “superior” ×3** — `sections/intro.tex:34`, `sections/experiments/accuracy.tex:16`, `sections/experiments/latency.tex:29`. Three or more occurrences of the same AI-tone word is MAJOR by the rule.
- **MINOR: “notably” ×2** — `sections/abstract.tex:13`, `sections/experiments/latency.tex:25`.
- **MINOR: “comprehensive experiments”** — `sections/intro.tex:34`; the other two “comprehensive” uses (`accuracy.tex:5`, `latency.tex:28`) are neutral.
- Not counted as hype: “exhibit” ×5 (`intro.tex:4`, `accuracy.tex:16`, `latency.tex:25`, `importance_approximation.tex:38`, `kernel_trick_and_calibration.tex:3`) — all technical uses such as “exhibits quadratic time complexity”, not the banned “exhibit superior capability” collocation. “surpass” ×1 (`appendix/main.tex:24`, numeric bound) and “exceed” ×4 (technical uses) are also neutral.
- **Em-dash: 0 occurrences** in all `.tex` sources. PASS.

### Final score (1–10)

4

### Submission recommendation

- Needs major revision before submission

### 卡片提醒

- **W01 先把贡献写成一到三条（共识）**：引言最后一段现在只有实验与结果；补三条贡献，每条指到一节，正好对上第 1 条 CRITICAL。
- **E02 证据先于叙事（共识）**：校准样本取自 InfiniteBench 的 Retrieve.KV，Table 2 又报 Retrieve.KV；先把校准和评测分开，再讲 best trade-off。
- **E05 差距要大过种子间的波动（共识）**：LongBench 平均 48.39 vs 48.77、NIAH 96.0 vs 96.1，差 0.1 到 0.4；greedy decoding 去掉了采样波动，但校准样本和计时仍有波动，只报一次要写理由或给重复次数。

完整报告在 `.duck/reports/2026-10-25-review.md`；`notebook.md` 与 `decisions.md` 已各记一条。

> 先编译再读正文：main.tex 同时加载 subfigure 和 subcaption，pdflatex 直接报冲突，不先修这个，页数、图注和交叉引用都核不了（原技能 Step 4）。
> 正文两处硬伤：式 (4) 把 m 写进了 log，按式 (3) 反解应是 m + ln(τl)（原技能 Step 1/7）；引言没有贡献清单，审稿人无法把主张对到 3/4 节（W01）。
> **先让论文编译通过，再把每条主张对到具体一节和一组证据。**
> 下次先跑一遍 pdflatex，再翻引言找贡献清单，最后才逐句改语法。
> ▸ 决策：把编译冲突和式 (4) 判为 CRITICAL，只给最小修法，没有替作者重排图；图内字号和红绿配色只报版面上看得见的问题（我定的）。

</details>

## why: `/duck-why` (83s)

- [x] must: says it is a reconstruction, not a replay
- [x] should: the breakdown is a blockquote
- [x] must: wrote a why report

<details><summary>reply</summary>

> 用的思路：五维审稿（宏逻辑、写作、语法、LaTeX、图）加 CRITICAL/MAJOR/MINOR 分级，每条发现都贴原文引用。
> 用的思路：先用编译器验证环境级问题，再用式 (3) 反解式 (4)，把读感换成可复核的判据。
> 为什么：五维和分级来自原技能 pre-submission-reviewer 的 Step 0-9 与 severity taxonomy；贡献清单用 W01，校准重叠用 E02，差距与波动的提醒用 E05。
> 为什么：先编译后读正文是我的判断，原技能只把 LaTeX 列为一维，没有规定顺序。
> 这次的过程：学生只拍了「审 paper/main.tex」；读全部 sections/、appendix/、pseudo_code/ 是我定的，因为 main.tex 只是 69 行的入口。
> 这次的过程：先编原件拿到 subfigure 与 subcaption 的 fatal error，再在 /tmp 副本里把 subcaption 换成 caption 编出 16 页，是我定的；把编译冲突和式 (4) 判 CRITICAL、把缺贡献清单判 CRITICAL，也是我定的。
> 这次的过程：决策行说「只给最小修法、没有替作者重排图」，和事实对得上：git status 显示论文文件没有改动，只有 .duck/ 是新增；图的问题只来自渲染页的目测。
> 放弃了什么：可以只审 main.tex 本身，但会漏掉正文；可以直接改论文，但原技能说输出是问题清单不是重写；可以把缺挑战段也判 CRITICAL，但引言是压缩不是整段缺失，我降成 MAJOR；可以把 exhibit 的 5 次都算禁用词，但它们是技术用法，我没有计入。
> （以上根据代码和过程记录重建，不是 AI 内部过程的回放。）
>
> **先把能被机器证伪的事（编译、公式、引用）查完，再进入措辞判断。**
> 要核对的话：用 m=2、l=1、τ=0.5 代入式 (3)，正确阈值是 S≥1.307，论文式 (4) 给 0.916；再跑一遍 pdflatex 看 \subcaption@CheckCompatibility 的报错，两件事一分钟内都能复核。

已写入 `.duck/reports/2026-10-25-why.md`，`notebook.md` 已追加一条。

</details>

## learn-ask: `/duck-learn` (15s)

- [x] must: opens with the one question

<details><summary>reply</summary>

先说一句：这次哪一步是你自己定的，哪一步最想重来？不想说可以跳过。

</details>

## learn: `审稿是我让做的，怎么审都交给你了。最想重来的是实验部分，我想先弄清审稿人最可能抓哪一条。` (74s)

- [x] must: wrote a learn report
- [x] should: next step is about the experiments

<details><summary>reply</summary>

**本来想干什么**：把 paper/main.tex 在投稿前审一遍，找出会挡投稿的问题；记录里没有更早的目标。你这次说明：审稿是你让做的，怎么审交给 AI；最想重来的是实验部分。

**实际怎样**：3 CRITICAL / 13 MAJOR / 17 MINOR，4/10；原件编不过，换成 caption 的副本编出 16 页，正文 9 页；67 条引用都能对上。这一段没有跑新实验，git log 只有一条 2026-10-25 的「初稿和实验代码」，论文文件没有改动。

**顶级导师会盯哪里**：

1. 校准样本和评测集重叠（E02、原技能 Step 1）：附录 C 的五个校准样本取自 InfiniteBench 的 Retrieve.KV，Table 2 又报 Retrieve.KV；这是数据泄漏，InfiniteBench 的数字会被高估。如果只抓一条，抓这条。
2. 缺 RAS 消融（原技能 Step 1、R02）：只消融了 QK 量化和 per-head calibration，没有 RAS 对普通 attention score 的对照，也没有 block size 扫描；审稿人会问提升到底来自哪一块。
3. Table 2 的 speedup 行和 Table 1 一样，都是 64K NIAH 的数，Table 2 没有标（我的判断）；审稿人会问为什么 InfiniteBench 的加速比恰好等于 LongBench。

**这次交给 AI 的判断**：决策行里三条：把编译冲突和式 (4) 判 CRITICAL；只给最小修法，没有替作者重排图；图内字号和红绿配色只报版面上看得见的问题。审稿范围和严重度也由 AI 定。下次想自己定，说一声就行。

**下一步**：先做校准和评测分离：用不相交的校准集，或至少排除那 5 条 Retrieve.KV，重跑 InfiniteBench 并记录新旧差值；顺手把 Table 2 的 speedup 行标成 64K NIAH 或按 benchmark 重测。再做 RAS 消融：All、-RAS（普通 attention score）、-4bit、block size 取 32、64、128，报 accuracy 和 latency。只能做一件就先做第 1 步，它会改现有数字。

已写入 `.duck/reports/2026-10-25-learn.md`，`notebook.md` 追加了 3 条。

</details>

## free: `帮我把 paper/main.tex 里摘要的第一句改得更紧凑一点（摘要在别的文件里就去那里找）。先在对话里给，文件先别改。` (38s)

- [x] should: no decision line
- [x] should: nothing new under .duck/
- [x] should: does not point to a duck command

<details><summary>reply</summary>

摘要在 `sections/abstract.tex` 第 1 句。原文 37 词，改成 21 词：

```latex
As Large Language Model (LLM) applications demand longer contexts, self-attention's quadratic complexity in sequence length has become the bottleneck during \prefill.
```

保留了 LLM 的首次定义、长上下文需求、二次复杂度和 prefill 瓶颈；去掉了 “Many advanced”“module”“stage of inference”“due to”“with respect to” 这些可以省掉的词。

文件没改，等你确认。

</details>

## global

- [x] must: notebook lines follow "- MM-DD 阶段｜原则（出处）"
- [x] must: decision lines read "- YYYY-MM-DD ▸ 决策：…"
- [x] should: new notebook lines say what happened this time (｜这次：)
- [x] must: no bold marks in notebook lines
- [x] must: no em-dash in notebook or decisions
- [x] must: no quizzes, homework or scoring the student
- [x] must: every card number the replies cite exists
