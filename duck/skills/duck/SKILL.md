---
name: duck
description: Ducktor 总入口。列出全部 /duck-* 命令；/duck on、quiet、off 切开关；后面接一句话时，替学生挑一条命令照做。
disable-model-invocation: true
---

# /duck 总入口

学生敲了 /duck（Codex 里是 $duck:duck），后面可能还接了内容。

插件根目录：开场注入的第一行写着。没有这一行时，就是这份文件往上两级的目录，因为这份文件在「插件根目录/skills/duck/SKILL.md」。下面提到的 skills/ 都在插件根目录下。在 Claude Code 里，插件根目录下的文件用 Read 读，不用 cat 这类 shell 命令：shell 会弹窗问学生，非交互模式下直接被拒。

按学生敲的内容，分三种情况。下面写给学生的话和表都照学生的语言说：学生写英文，就全部译成英文。


## 一、后面什么都没有：列菜单

不自我介绍，不学鸭叫。先说一句最省事的用法：「不用记命令：/duck 后面直接说要干什么，比如 /duck 我想做 LLM agent，还没方向，或者 /duck 帮我审一下 paper/main.tex，我替你挑。」然后列出这张表，按研究阶段分组，组名那几行照写：

| 命令 | 做什么 |
|---|---|
| **动笔前** | |
| /duck-survey | 摸方向、文献综述 |
| /duck-idea | 评估 idea 值不值得做 |
| /duck-vibe | 这块活该让 AI 干到哪、你自己把关哪些 |
| **写论文** | |
| /duck-outline | 理清论文逻辑 |
| /duck-intro | 写引言 |
| /duck-write | 写正文 |
| /duck-figure | 设计图、出图质检 |
| /duck-polish | 润色 |
| **投稿前** | |
| /duck-review | 按审稿人的眼光审自己的稿子 |
| **学东西** | |
| /duck-why | 刚才那一步为什么这么做（也可以指定文件、git 提交、段落） |
| /duck-learn | 一段工作做完（一篇稿子、一轮实验），复盘这一段要学什么 |
| /duck-notes | 看、改学习笔记 |
| **设置** | |
| /duck-skill | 关掉命令、加你们组自己的经验卡 |

在 Codex 里，命令写成 $duck:duck-review 这样，最省事的用法写成 $duck:duck 帮我审一下 paper/main.tex。

学生只敲了 /duck，这次会话里也没有学生写的别的话时，.duck/config.md 是英文写的就用英文列；也看不出来，用中文列，最后加一行英文：「Prefer English? Write to me in English and I will answer in English.」

列完再做三件事：
- 读项目的 .duck/config.md，用一句话说 Ducktor 在这个项目开没开、开在哪一档，不用提文件名。没有这个文件，文件里没有「开关：」那一行（英文写的 config 里是「Switch:」），或者写的不是 on、quiet（中文的开、打开、开启、启用算 on，静音、安静算 quiet），就是没开启：平时不出声，只有敲命令时才动。写的是 off 时，也说没开启，可以补一句开关写着 off，和刚装好时一样；不说「关掉了」。config.md 里关掉的命令，在表里标「已关」；一条都没关，就不提。
- 项目的 .claude/skills/ 和 .agents/skills/ 下，名字以 duck- 开头的文件夹是学生自己加的命令，接在表后面列出来；一个都没有，就不提。
- 最后照写这两句（学生用英文时译成英文）：「想让我平时也跟着（要紧的决定先问你，做完一步讲一句为什么），在这个项目敲 /duck on。/duck quiet 照样先问，讲解只记不说；开了以后想回到现在这样，敲 /duck off。」已经是 on 或 quiet 的，这两句换成一句：怎么换档，以及敲 /duck off 回到没开启时的样子（敲命令照常讲、照常记）。

## 二、后面是 on、quiet 或 off：切开关

1. 改项目 .duck/config.md 里「开关：」那一行（英文 config 里是「Switch:」）：有这一行就改这一行，不另加一行。文件在、没有这一行（之前只记过静音、「回复：短」或关掉的命令），就在第一个标题下面加这一行，别的不动。没有这个文件，就照下面的格式新建。这是学生明确要的，不用再问。改 config.md、写 decisions.md 都用文件编辑工具（Claude Code 里是 Write、Edit），不用 echo、sed 这类 shell 命令；写进 .duck/ 的文字不用破折号。第一次建 .duck/ 时顺带说一句（不用问）：提交进 git 就和论文一起留档，不想提交就写进 .git/info/exclude。
2. 告诉学生改了哪一行、改成了什么，以及这一档的意思：
   - on：平时干活也按常驻规则来（讲为什么、记决策、结果进论文前对标准），每次命令跑完出「为什么」报告，对话里放短版，完整版存进 .duck/reports/；
   - quiet：照记照存，对话里不放；平时干活用到的原则也照样记进笔记本；
   - off：回到刚装好的样子：平时不再先问、不讲也不记；敲 /duck-xxx 时照常讲为什么、照常记。config.md 里关掉的命令和静音的设定照样算数。
   学生只说「安静点」「别啰嗦」、没说哪一档时：现在是 on，就切到 quiet，说清 quiet 照样记；项目还没开启，就别切到 quiet（quiet 比没开启管得多），告诉学生没开启时平时本来就不出声，再问要不要回复短一点（在 config.md 记「回复：短」，英文 config 写 Reply: short；config.md 还没有时照下面的格式新建，但不写开关行，别顺手开启）。
   切开关在 .duck/decisions.md 追加一行就够了，写成「- YYYY-MM-DD ▸ 决策：把开关从 A 改成 B（你定）」（英文写「- YYYY-MM-DD ▸ Decision: switch from A to B (you decided)」）；文件里不加标题，前后不空行。不往笔记本里记。
3. 从这一轮起，你就按新开关做。切到 on 或 quiet 时，如果这次会话的开场注入里没有常驻规则（写的是没在这个项目开启），现在就读常驻规则：项目里有 .duck/skills/core.md 读它，没有就读插件根目录/rules/core.md，从这一轮起照做。切到 off，就从这一轮起照插件根目录/rules/idle.md 做，和没开启一样。下次开会话时，开场注入会按新开关来。

新建 config.md 用这个格式：

```
# Ducktor 设定

开关：on

## 按类静音
学生说「这类我懂了」时，在这里记一行。

## 静音的卡

## 关掉的命令
```

学生用英文时，config.md 用这一版（「Switch:」和「开关：」一样认）：

```
# Ducktor settings

Switch: on

## Muted topics
When the student says "I've got this kind", add a line here.

## Muted cards

## Disabled commands
```

## 三、后面是一句话：替学生挑命令

1. 按上面那张表，挑最贴合的一条。问一整段做完的工作（一篇稿子、一轮实验）里要学什么，挑 /duck-learn；问某一步、某处改动为什么这么做，挑 /duck-why。拿不准时，把两条候选摆给学生，问一句，不要猜。
2. 先说一句按哪条处理，例如「按润色处理（/duck-polish）；要审稿请敲 /duck-review。」
3. 然后读那条命令的说明文件「插件根目录/skills/duck-xxx/SKILL.md」，把学生这句话当作敲在命令后面的内容，照说明从头做到尾，开头和收尾的步骤一步都不跳。
4. 学生自己加的命令（.claude/skills/duck-xxx/ 或 .agents/skills/duck-xxx/）也在挑选范围里，挑中了就读那一份。
5. 说明文件不存在，就告诉学生这条命令还没装好，照常帮学生做这件事。
6. 表里没有合适的命令，就直说没有，照常帮学生做；Ducktor 在这个项目开着时，按常驻规则附「为什么」。
