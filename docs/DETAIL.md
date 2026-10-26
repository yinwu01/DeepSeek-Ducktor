# Doctor Duck

> Trust me, I'm a Ducktor.

With an AI agent doing the literature search, the experiments and the introduction, the step where you explain your own work to someone is easy to skip. Then someone at group meeting asks why you only compared against those two baselines, and you cannot say: you did not make that choice, and nobody wrote down why the AI did.

Doctor Duck brings that step back. When the AI finishes a real piece of work, the duck says why in a sentence or two, and when there was a trade-off it logs one line: what was chosen, what was dropped, and whether you or the AI decided. Before a decision that changes the approach, it stops and asks you. `/duck-why` takes apart the last step; `/duck-learn` reviews a stretch of work.

This plugin brings Doctor Duck into DeepSeek Harness unchanged. The rules, commands and cards are the ones Claude Code and Codex users get, pinned to one Doctor Duck commit (named in `duck.lock.json` in the plugin folder). Doctor Duck itself speaks Chinese.

## Use

- Type `/` in the composer to see every `/duck-*` command. Start with `/duck`.
- After installing, the duck is off in every project and speaks only when you run a `/duck-*` command.
- `/duck on` turns it on in this project: from then on it explains and logs decisions during ordinary work too.
- `/duck quiet` keeps the explanations out of the conversation but still writes them to the notebook.
- `/duck off` turns it off.
- Everything the duck writes goes under the project's `.duck/`: `config.md`, `notebook.md`, `decisions.md` and `reports/`.

## Settings

All three are optional.

- `duckRoot`: absolute path of your own Doctor Duck checkout, used instead of the copy in this plugin.
- `sessionContext`: on by default. Off leaves only the commands; sessions no longer get the opening context and resident rules.
- `subagents`: off by default. On gives subagent sessions the opening context too; they cannot stop to ask you, which is why the default leaves them out.

## What it does

- The 14 `/duck-*` commands are registered as DeepSeek Harness skills that only you can run; the model does not invoke them on its own.
- The opening context that a SessionStart hook gives Claude Code and Codex (plugin root, the project's switch, the resident rules when on) goes into the first model request of each session, built by the same Doctor Duck code. It is given again when `.duck/config.md` changes or after compaction.
- The plugin only reads local files and makes no network requests of its own.

## License

Plugin code: MIT; plugin documentation: CC BY-NC-SA 4.0. Doctor Duck in `duck/` is licensed by directory: its text (skills/, rules/, cards/, handbook/) is CC BY-NC-SA 4.0 (non-commercial), each original skill in `library/` keeps its own license, and its code is MIT. Doctor Duck is adapted from Supervisor-Skills by Yuyu Luo and contributors (CC BY-NC-SA 4.0).
