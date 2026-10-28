# DeepSeek-Doctor

> Trust me, I'm a Ducktor.

With an AI agent doing the literature search, the experiments and the introduction, the step where you explain your own work to someone is easy to skip. Then someone at group meeting asks why you only compared against those two baselines, and you cannot say: you did not make that choice, and nobody wrote down why the AI did.

Ducktor brings that step back. When the AI finishes a real piece of work, Ducktor says why in a sentence or two, and when there was a trade-off it logs one line: what was chosen, what was dropped, and whether you or the AI decided. Before a decision that changes the approach, it stops and asks you. `/duck-why` takes apart the last step; `/duck-learn` reviews a stretch of work.

This plugin brings Ducktor into DeepSeek Harness unchanged. The rules, commands and cards are the ones Claude Code and Codex users get, pinned to one Ducktor commit (named in `duck.lock.json` in the plugin folder). Ducktor itself speaks Chinese.

DeepSeek-Doctor is a community plugin. It is not made by DeepSeek and has no connection to the company.

## Use

- Type `/` in the composer to see every `/duck-*` command. Start with `/duck`.
- After installing, Ducktor is not turned on in any project. It speaks only when you run a `/duck-*` command.
- `/duck on` turns it on in this project: from then on it explains and logs decisions during ordinary work too.
- `/duck quiet` keeps the explanations out of the conversation but still writes them to the notebook.
- `/duck off` puts it back to how it is after you install it: it is silent during ordinary work, and the commands still explain and write their records.
- Everything Ducktor writes goes under the project's `.duck/`: `config.md`, `notebook.md`, `decisions.md`, `reports/` and `background.md`.

## The Ducktor tab

In the Web GUI, open the right sidebar and pick Ducktor (Desktop uses the same web interface; not tested). It puts what Ducktor wrote next to the conversation: the calls the AI made for you (the ones waiting for your confirmation first), the principles to take away, what to check yourself in the latest report, background on the direction you are exploring, and the experience cards your recent steps point to. While open it checks `.duck/` every 4 seconds; it only reads local files and costs no model tokens.

Besides Ducktor's 23 experience cards, the plugin ships 11 of its own (`mentor/cards/`, in Chinese): reading papers, entering a new area, when to switch problems, looking at data and errors, tuning baselines, traceable results, keeping the test set for the end, a research log, meeting your advisor, responsibility when AI does the work, and the rules for AI when reviewing. Each names its sources; they were checked against the originals while drafting, and two separate model sessions acting as red team (not human reviewers) rechecked every claim before release. Venue rules cite the newest edition published on 2026-10-26 (ICLR 2027; ICML and NeurIPS 2026). They change every year, and each card records the date it was checked.

## Settings

All three are optional.

- `duckRoot`: absolute path of your own Ducktor checkout, used instead of the copy in this plugin.
- `sessionContext`: on by default. Off leaves only the commands; sessions no longer get the opening context and resident rules.
- `subagents`: off by default. On gives subagent sessions the opening context too; they cannot stop to ask you, which is why the default leaves them out.

## What it does

- The 14 `/duck-*` commands are registered as DeepSeek Harness skills that only you can run; the model does not invoke them on its own.
- The opening context that a SessionStart hook gives Claude Code and Codex (plugin root, the project's switch, the resident rules when on) goes into the first model request of each session, built by the same Ducktor code. It is given again when `.duck/config.md` changes or after compaction.
- A few lines after the opening context say where the extra cards are; that when Ducktor is on or you run a command, papers, datasets and tools come with links found this time; and that the first exploration of a direction writes `.duck/background.md`.
- The Ducktor tab is a browser-side page that reads `.duck/` and the cards.
- The plugin only reads local files and makes no network requests of its own. Commands such as `/duck-survey` and `/duck-idea` make the AI search the web.

## License

Plugin code (including the tab): MIT; plugin documentation and the extra cards (`mentor/`): CC BY-NC-SA 4.0. Ducktor in `duck/` is licensed by directory: its text (skills/, rules/, cards/, handbook/) is CC BY-NC-SA 4.0 (non-commercial), each original skill in `library/` keeps its own license, and its code is MIT. Ducktor is adapted from Supervisor-Skills by Yuyu Luo and contributors (CC BY-NC-SA 4.0).
