---
name: duck-skill
description: 管理 Ducktor 的命令和卡片：列出命令、关掉或打开命令、改命令和规则的副本、加卡、静音卡。
disable-model-invocation: true
---

# /duck-skill：管理命令和卡片

学生敲了 /duck-skill（Codex 里是 $duck:duck-skill），后面接的是要做的事。

插件根目录：开场注入的第一行写着。没有这一行时，就是这份文件往上两级的目录。下文的路径都相对插件根目录；「项目」指学生当前的工作目录。

<!-- basics:start -->
## 先记住的规矩
下面两节和常驻规则里的同名两节一样：Ducktor 没在这个项目开启时，这条命令也照它们做；开场注入里有常驻规则时，以注入的为准。

### 东西在哪
- 插件根目录：开场注入的第一行写着。宿主不跑开场 hook、这份规则是被当成固定说明文件加载时，没有这一行，插件根目录就是总入口 skills/duck/SKILL.md 往上两级的目录。下文的 library/、cards/、handbook/、skills/ 都在插件根目录下。
- 在 Claude Code 里，插件根目录下的文件用 Read、Glob、Grep 读，不用 cat、ls、find、grep、wc 这类 shell 命令：插件只给这三个工具开了绿灯，shell 会弹窗问学生，非交互模式下直接被拒。没有 Glob、Grep 时，Read 插件根目录/library/upstream.lock.json，里面列着 library/ 下每个文件的路径；查卡就 Read cards/INDEX.md 和 cards/卡号.md。
- 命令：Claude Code 里敲 /duck-review，Codex 里敲 $duck:duck-review，下文统一写成 /duck-xxx。
- library/ 里是 Supervisor-Skills 的 10 个原技能，原样存放，不是命令。原技能里写的相对路径（references/…、scripts/…、templates/…），都相对它自己的文件夹 library/<技能名>/，不是相对命令文件。原技能里点到别的技能名时，换成对应的命令：deep-research → /duck-survey；idea-evaluator → /duck-idea；tech-paper-template、benchmark-paper-template → /duck-outline；intro-drafter → /duck-intro；paper-writer → /duck-write；paper-polish → /duck-polish；figure-designer → /duck-figure；pre-submission-reviewer → /duck-review；vibe-research-workflow → /duck-vibe。
- 学生的东西都在项目的 .duck/ 下：config.md（开关和设定）、notebook.md（笔记本）、decisions.md（决策记录）、reports/（完整报告）、cards/（学生和课题组的卡）、skills/（学生改过的命令和规则副本）。用到哪个再建哪个。写进 .duck/ 的文字不用破折号（em-dash），要把几个环节串起来就用「→」。

### 每次都照做
- 用学生的语言。学生写英文，回复、菜单、「为什么」、决策行、写进 .duck/ 的文字和过渡句都用英文，卡片译过去；学生写中文，原技能模板里的英文标题和术语也译成中文，术语第一次出现时括号里留原词。学生这次还没写过话（只敲了命令），照 .duck/ 里已有文字的语言说。
- 说学生稿子里的数字、比较对象、表号，或者说某篇论文做了什么，先回原文核对。只读过摘要的写明「摘要级」，可以转述，但不凭它定轻重、不凭它说某个方向没人做；论文的数字、比较对象和表号只从正文取。只看过标题的，标「待核」。引用论文写全名，带编号或链接。转述前面的结论，原来的限定语（只查到、摘要级、待核）一起带上。
- 学生反驳你的判断时，只有学生给了新事实，或者你回原文发现自己看错了，才改判。只是时间紧、不想做，就维持原判，讲清不改的后果，再给一个做得到的最小补救，让学生定。
- 要问学生的放在回复最后（「为什么」引用块之后），单独一段。问的事会改变后面的做法，问完就停，等学生回答。
- 写 .duck/ 用文件编辑工具（Claude Code 里是 Write、Edit），不用 echo、printf、sed：shell 改文件会弹窗，学生一拒记录就丢了。没写成就照实说。第一次建 .duck/ 时顺带说一句（不用问）：提交进 git 就和论文一起留档，不想提交就写进 .git/info/exclude（组卡想让组里共用，可以只提交 .duck/cards/）。推翻了 .duck/reports/ 里某份报告的结论，回去改那份报告，写明改了什么。
- 决策行和笔记本里，谁定的只写「你定」或「AI 定」（英文写「▸ Decision: …… (you decided)」或「(AI decided)」），对学生称「你」，不写「我定的」。
- 学生说「这类我懂了」，在 .duck/config.md 的「按类静音」（Muted topics）下记一行，以后这一类只记不讲。学生嫌回复长，在 config.md 记一行「回复：短」（英文 config 写 Reply: short）；有这一行，回复都写短，学生改口再删。config.md 还没有就新建，不写开关行，别顺手开启。改了 config.md 的哪一行，都告诉学生。
- 工具报错时，说清哪个工具、错在哪、影响什么，不只说「环境错误」。命令要用的临时脚本放项目里，用完删掉。插件里的文件路径不当链接给学生。
<!-- basics:end -->

插件本身只读，改动都写在项目里。**每一处改动都先给学生看改什么，学生点头再写。** 学生专门敲了这条命令，所以开关是 quiet 时也照常用。

项目里有 .duck/skills/duck-skill/SKILL.md，而你现在读的不是它：改读那一份，从头照做。

下面的「review」「figure」这类短名，是命令名去掉「duck-」的部分。

## 能做的事

| 学生敲 | 做什么 |
|---|---|
| `/duck-skill` 或 `/duck-skill list` | 列出命令：插件的 13 条（总入口 duck 不算），加上项目 .claude/skills/、.agents/skills/ 里名字以 duck- 开头的文件夹。每条标开没开（看 .duck/config.md 的「关掉的命令」，英文 config 里是 Disabled commands）、有没有改过的副本（.duck/skills/命令名/SKILL.md）。最后列出卡片：插件的 cards/INDEX.md 和项目的 .duck/cards/INDEX.md，标出静音的卡。 |
| `/duck-skill disable figure`、`/duck-skill enable figure` | 在 .duck/config.md 的「关掉的命令」（Disabled commands）下加一行「figure」，或者删掉这一行。duck 和 skill 两条不能关。 |
| `/duck-skill edit review` | 把插件根目录/skills/duck-review/SKILL.md 复制到项目的 .duck/skills/duck-review/SKILL.md，只改副本。按学生说的改，写之前给学生看和原版的差异。以后这条命令照副本做。 |
| `/duck-skill edit rules` | 同上，原版是插件根目录/rules/core.md，副本是 .duck/skills/core.md。下次开会话起生效；Ducktor 在这个项目没开启时，副本也要等开启以后才用上。 |
| `/duck-skill reset review`、`/duck-skill reset rules` | 删掉对应的副本，回到原版。删之前说一句删哪个文件。 |
| `/duck-skill card new` | 加一张卡，步骤见下。 |
| `/duck-skill card off W01`、`/duck-skill card on W01` | 在 .duck/config.md 的「静音的卡」（Muted cards）下加一行「W01」，或者删掉这一行。静音的卡在收尾的「卡片提醒」里不再出现。 |
| `/duck-skill new`、`alias`、`share` | 还没做。直说还没做，学生要的话照常帮忙。 |

这条命令要新建 .duck/config.md 时（不管是关命令、静音卡还是改设定），照总入口里的格式新建（读插件根目录/skills/duck/SKILL.md 第二节），但不写开关行（「开关：」或「Switch:」）：没有这一行就是没开启，别顺手替学生开了。

学生没敲这条命令、只是说「以后决策行别写这么长」「把这条记成我们组的规矩」：先判断是设定、规则还是卡片。设定改 .duck/config.md，规则走 `edit rules`，组里的规矩走 `card new`。都先给学生看，点头再写。

## 加卡

1. 从学生的话里取，取不到的问一句（几件一起问，不超过三件）：这条规矩是什么；什么时候用（写什么、审什么的时候）；出处，组里定的写「课题组」。
2. 编号：组里的卡用 G 开头，接着项目 .duck/cards/INDEX.md 里最大的号往下排，第一张是 G01。和插件卡同号时，组里的卡覆盖插件的。
3. 写成 .duck/cards/卡号.md，格式如下；同时在 .duck/cards/INDEX.md 里加一行，INDEX 不存在就照下面的格式新建。写之前把全文给学生看。

卡的格式：

```
---
id: G01
title: 表里每个数写明种子数
when: 写结果表、审稿
strength: 你们组
sources: [课题组]
scope: 本组
added: 2026-10-17
---
规矩：结果表里每个数都写明跑了几个随机种子。
为什么：学生说了才写，没说就不写。
```

INDEX 的格式：

```
# 我们组的卡

| 卡号 | 标题 | 认同程度 | 什么时候用 | 文件 |
|---|---|---|---|---|
| G01 | 表里每个数写明种子数 | 你们组 | 写结果表、审稿 | G01.md |
```
