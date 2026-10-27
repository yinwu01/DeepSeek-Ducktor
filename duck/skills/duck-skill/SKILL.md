---
name: duck-skill
description: 管理 Ducktor 的命令和卡片：列出命令、关掉或打开命令、改命令和规则的副本、加卡、静音卡。
disable-model-invocation: true
---

# /duck-skill：管理命令和卡片

学生敲了 /duck-skill（Codex 里是 $duck:duck-skill），后面接的是要做的事。

插件根目录：开场注入的第一行写着。没有这一行时，就是这份文件往上两级的目录。下文的路径都相对插件根目录；「项目」指学生当前的工作目录。

插件本身只读，改动都写在项目里。**每一处改动都先给学生看改什么，学生点头再写。** 学生专门敲了这条命令，所以开关是 quiet 或 off 时也照常用。

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
