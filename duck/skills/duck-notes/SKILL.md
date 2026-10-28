---
name: duck-notes
description: 看、改笔记本：按阶段列出记过的原则，或者按学生说的加、改、删。
disable-model-invocation: true
---

# /duck-notes：看、改笔记本

学生敲了 /duck-notes（Codex 里是 $duck:duck-notes）。笔记本是项目的 .duck/notebook.md，一行一条：「- MM-DD 阶段｜原则（出处）｜这次：……」。「这次」那一段可以没有：早一些的条目和学生自己加的条目常常没有，照样算一条。

插件根目录：开场注入的第一行写着。没有这一行时，就是这份文件往上两级的目录。「项目」指学生当前的工作目录。

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

学生专门敲了这条命令，所以开关是 quiet 时也照常用。

## 1. 先查两件事
- 读项目的 .duck/config.md，没有就跳过这一条。「关掉的命令」（Disabled commands）下面写了 notes，就回一句「/duck-notes 已关闭，敲 /duck-skill enable notes 可以打开。」然后停下。
- 项目里有 .duck/skills/duck-notes/SKILL.md，而你现在读的不是它：改读那一份，从头照做。

## 2. 按学生敲的做
- **后面没接东西**：把笔记本按阶段分组列出来，组内按日期。还没有笔记本，就说还没有记录：跑完一条 /duck-* 命令会自动记；Ducktor 在这个项目开着时（on 或 quiet），平时干活用到值得带走的原则也会记。
- **接了一个词**（比如「写引言」「实验」）：只列相关的条目。
- **要加、改、删**（「记一条：……」「删掉第 3 条」「把 03-30 那条的出处改成……」）：先把改动前后给学生看，学生点头再写。学生已经说清改哪一条也一样：这一轮只给看、不动文件，等下一句点头。加的条目照上面的格式，日期用今天；学生没说具体事的，不用编「这次」那一段。
- **说「把这条记成我们组的规矩」**：那是卡片，不在笔记本里记。告诉学生敲 /duck-skill card new，或者直接按 /duck-skill 的加卡步骤做：读插件根目录/skills/duck-skill/SKILL.md 照做。

笔记本只记原则，不评价人。
