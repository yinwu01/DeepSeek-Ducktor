# Doctor Duck 导师鸭

> Trust me, I'm a Ducktor.

用 AI agent 做科研，文献、实验、引言都能交给 AI，「讲一遍」这一步却很容易省掉。组会上有人问一句「为什么只比这两个 baseline」，你可能答不上来：这个决定不是你做的，AI 做的时候也没人记下来。

Doctor Duck 把「讲一遍」找回来：

- AI 做完一步实质性的活，鸭子讲一句为什么。有取舍时再记一行：选了什么，放弃了什么，是你定的还是 AI 拍的板。
- 碰到会改变做法的决定，它先停下来问你。
- 想看清 AI 刚才那一步是怎么做的，敲 `/duck-why`。
- 一段做完，敲 `/duck-learn` 复盘。

这个插件把 Doctor Duck 原样带进 DeepSeek Harness。规则、命令、卡片和 Claude Code、Codex 里的是同一份，固定在 Doctor Duck 的一个提交上（插件目录里的 `duck.lock.json` 写着是哪个）。

## 怎么用

- 在输入框敲 `/`，能看到全部 `/duck-*` 命令。不知道从哪开始，先敲 `/duck`。
- 刚装好时，鸭子在哪个项目里都没开启，只在你敲 `/duck-*` 命令时出声。
- `/duck on`：在这个项目里开启。之后平时干活也跟着讲为什么、记决策。
- `/duck quiet`：对话里不讲，道理照样记进笔记本。
- `/duck off`：关掉，命令也不再写记录。
- 鸭子的东西都写在项目的 `.duck/` 下：`config.md`（开关和设定）、`notebook.md`（笔记本）、`decisions.md`（决策记录）、`reports/`（完整报告）、`background.md`（这个方向的背景）。

## 网页界面的「鸭子」页签

在 Web 界面里打开右侧边栏，选「鸭子」（Desktop 用同一套网页界面，没测过）。它把 `.duck/` 里的东西摆在对话旁边：

- 这次 AI 替你定的：哪些板是 AI 拍的、哪些是你定的；要你确认的排在最前面。
- 可以带走的原则：每一步留下的一条做法，写着出处和「这次」发生了什么。
- 该你亲手核对的：最近一份报告里要你自己看的地方，点一下打开整份报告。
- 领域背景：第一次用 `/duck-survey` 或 `/duck-idea` 摸一个方向时写下的代表作、数据集和还没定论的问题，都带链接。
- 导师会提醒你的：最近几步点到的经验卡片，写着道理、怎么用和出处。

页签打开时每 4 秒看一次 `.duck/` 有没有更新，只读本地文件，不花模型的 token。

除了 Doctor Duck 自带的 23 张卡，插件另带 11 张：读论文、进新方向、换不换题、看数据和错误样本、基线调参、结果可追溯、测试集只在最后看、研究日志、和导师开会、用 AI 做研究的责任、审稿时用 AI 的规矩。每张都写明出处；起草的人对过原文，交付前另有两位审阅人逐条重查。会议规则引的是 2026-10-26 能查到的最新一届（ICLR 2027，ICML 和 NeurIPS 2026），每年会变，卡上写了核对日期。

## 命令

| 命令 | 做什么 |
|---|---|
| `/duck` | 总入口：列出全部命令；`/duck on`、`quiet`、`off` 切换开关；后面接一句话，它替你挑一条命令照做 |
| `/duck-survey` | 摸方向、做文献综述 |
| `/duck-idea` | 评估一个研究 idea |
| `/duck-outline` | 理清论文逻辑，技术论文和 benchmark 论文各用一个模板 |
| `/duck-intro` | 写论文引言 |
| `/duck-write` | 写论文正文 |
| `/duck-figure` | 设计论文配图，或检查画好的图 |
| `/duck-polish` | 润色论文语言，不改意思 |
| `/duck-review` | 投稿前审一遍论文，问题标明来源 |
| `/duck-vibe` | 判断一块研究工作该让 AI 做到哪一步、用什么工具 |
| `/duck-why` | 拆解刚才那一步，或者指定的文件、函数、提交、段落 |
| `/duck-learn` | 阶段复盘：本来想干什么、实际怎样、哪些判断交给了 AI、下一步 |
| `/duck-notes` | 看、改笔记本 |
| `/duck-skill` | 管理命令和卡片：关掉或打开命令、改副本、加卡、静音卡 |

从 `/duck-survey` 到 `/duck-vibe` 这九条，照 [Supervisor-Skills](https://github.com/HKUSTDial/Supervisor-Skills) 的十个原技能做（`/duck-outline` 用了技术论文、benchmark 论文两个模板），收尾讲为什么。

## 设置

插件的设置页有三项，都可以不填：

- `duckRoot`：用你自己的 Doctor Duck 目录（绝对路径），不用插件自带的那份。
- `sessionContext`：默认开。关掉以后只剩命令，会话不再带开场说明和常驻规则。
- `subagents`：默认关。打开后子代理会话也带开场说明；默认不带，因为子代理没法停下来问你。

## 它做了什么

- 命令：14 条 `/duck-*` 命令登记成 DeepSeek Harness 的技能，只能由你敲出来，模型不会自己调用。
- 开场说明：Claude Code、Codex 里由开场 hook 注入的那段（插件根目录、这个项目的开关、开启时的常驻规则），这里在每个会话的第一次模型请求里给出，由同一份 Doctor Duck 代码生成。`.duck/config.md` 改了，或者对话被压缩过，会再给一份。
- 开场说明后面另有几行：另带的经验卡片在哪；鸭子开着或你敲了命令时，列论文、数据集、工具要附查到的链接；第一次摸一个方向时写 `.duck/background.md`。
- 「鸭子」页签：浏览器里的一页，读 `.duck/` 和经验卡片来显示。
- 插件只读本地文件，自己不联网。对话照常发给你在 DeepSeek Harness 里选的模型。

## 许可

插件代码（含页签）是 MIT，插件的文档和另带的经验卡片（`mentor/`）是 CC BY-NC-SA 4.0。`duck/` 里的 Doctor Duck 按目录分：文字（skills/、rules/、cards/、handbook/）是 CC BY-NC-SA 4.0，不可商用；`library/` 里的原技能各自保留原来的许可；代码是 MIT。Doctor Duck 改编自 Supervisor-Skills（骆昱宇及贡献者，CC BY-NC-SA 4.0）。
