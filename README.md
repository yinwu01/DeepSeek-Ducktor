# deepseek-ducktor

> Trust me, I'm a Ducktor.

Doctor Duck（讲为什么的科研导师）的 DeepSeek Harness 原生插件。装上以后，在 DeepSeek Harness 的 Web、Desktop 和命令行里都能敲 `/duck-review` 这类命令；在开启了鸭子的项目里，每个会话都带着 Doctor Duck 的常驻规则。规则、命令和卡片是 Doctor Duck 的原文，和 Claude Code、Codex 用户拿到的是同一份。

Doctor Duck 是什么、怎么用，见 [docs/DETAIL.zh.md](docs/DETAIL.zh.md)。这一页也是插件装好后在「插件」页里看到的详情（dsh 支持详情文档的版本才显示）。

## 要求

DeepSeek Harness 0.2.1-rc.2 及以上、0.3 以下（`package.json` 的 `engines.dsh`，dsh 安装时会检查）。

## 安装

三种方式任选一种。项目里的 `.duck/` 是学生自己的记录，装、卸插件都不会动它。

### 方式一：插件页（Web、Desktop）

1. 把这个仓库放到本机任意位置（`git clone` 或下载解压）。
2. 在 DeepSeek Harness 里打开侧边栏的「插件」，选「安装第三方插件」，在「包名或地址」里填仓库的绝对路径，例如 `/Users/you/deepseek-ducktor`。
3. 装好就生效，不用重启。插件卡片上显示「Doctor Duck 导师鸭」。

卸载在同一页面里点「卸载」。npm 装的 dsh 用 PATH 上的 `pnpm` 装插件；Desktop 自带 pnpm。

### 方式二：命令行

```sh
dsh plugin --profile web add /绝对路径/deepseek-ducktor
dsh plugin --profile headless add /绝对路径/deepseek-ducktor
```

每个 profile 单独装，需要 PATH 上有 `pnpm`。卸载把 `add /绝对路径/deepseek-ducktor` 换成 `remove deepseek-ducktor`。

Desktop 的 profile 名是 `desktop`：先打开一次 Desktop，完全退出，再用 Desktop 自带的 `dsh` 命令（Desktop 菜单「管理 dsh 命令…」可以把它注册到终端）运行 `dsh plugin --profile desktop add /绝对路径/deepseek-ducktor`，然后重新打开 Desktop。

### 方式三：不装 pnpm（命令行）

在 `~/.dsh/cordis.patch.yml`（设了 `DSH_HOME` 就是 `$DSH_HOME/cordis.patch.yml`）里加一行：

```yaml
- insert:
    - id: deepseek-ducktor
      name: /绝对路径/deepseek-ducktor/index.js
```

这一行对所有 profile 生效，下次启动 dsh 时加载。卸载就删掉这一行。

Desktop 用户不要用这种方式：这一行对 Desktop 也生效，会盖过插件页装的那一份，而它在 Desktop 里能不能找到 dsh 自带的包没测过。Desktop 请用方式一。

这一行和方式一、二装上的那一行 id 相同，会盖过它们，不会注册两遍。所以要改设置，也写在这一行里（见下一节）。

## 设置

三项都可以不填。用方式一、二装的，在插件页插件的「配置」里改。用了方式三那一行的，改那一行的 `config:`；它优先级更高，插件页里改的会被它盖过（插件页会提示「被更高优先级的配置覆盖」）：

```yaml
- insert:
    - id: deepseek-ducktor
      name: /绝对路径/deepseek-ducktor/index.js
      config:
        duckRoot: /绝对路径/Doctor-Duck
        sessionContext: true
        subagents: false
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `duckRoot` | 插件自带的 `duck/` | 用你自己的 Doctor Duck 目录，必须是绝对路径 |
| `sessionContext` | `true` | 关掉以后只剩命令，会话不再带开场说明和常驻规则 |
| `subagents` | `false` | 子代理会话也带开场说明。默认不带，因为子代理没法停下来问学生 |

## 和 Claude Code、Codex 版有什么不同

| | Claude Code、Codex | DeepSeek Harness（本插件） |
|---|---|---|
| 命令 | Claude Code 里 `/duck-review`，Codex 里 `$duck:duck-review` | `/duck-review`，输入框敲 `/` 能看到全部 14 条；只能学生敲，模型不会自己调用 |
| 开场说明 | 开场 hook 在会话开始时注入一次 | 每个会话的第一次模型请求带上；`.duck/config.md` 改了，或者对话被压缩过，下一步再给一份。会话中途 `/duck on`，常驻规则当场就到 |
| 生成开场说明的代码 | Doctor Duck 的 `bin/duck.js` | 同一份 `bin/duck.js`，后面加一段 DeepSeek Harness 附注：工具对照（read、glob、grep）、项目目录的绝对路径 |
| 读插件里的文件 | Claude Code 里插件给 Read、Glob、Grep 开了绿灯 | dsh 的每种沙箱模式都不拦读文件，不用学生批准；插件目录只读 |
| 学生自己加的命令 | 放项目的 `.claude/skills/duck-xxx/` 或 `.agents/skills/duck-xxx/` | dsh 只读 `.agents/skills/`（和 `.dsh/skills/`），不读 `.claude/skills/`。名字别和插件的 14 条重复：dsh 里插件自带的技能优先级最低，同名的会盖过插件的命令 |
| 项目目录 | 开场 hook 收到的目录 | 会话创建时的目录，开场说明里写明它和 `.duck/` 的绝对路径；模型在会话里换了工作目录，`.duck/` 仍是原来那个 |

## 怎么做的

- `index.js`：dsh 插件入口。把 `duck/skills/` 下的 14 条命令登记成技能（技能的基础目录就是 Doctor Duck 根目录，命令里「相对插件根目录」的路径因此对得上）；在每一步模型请求之前检查开场说明是否需要给、是否过期。
- `lib/duck.js`：和 dsh 无关的部分（找根目录、读 SKILL.md、生成和判断开场说明），单元测试直接用 Node 跑。
- `duck/`：Doctor Duck 原样拷贝，不手改。`duck.lock.json` 记着来自哪个提交和每个文件的 sha256。更新 Doctor Duck：

  ```sh
  node scripts/sync-duck.mjs --from /path/to/Doctor-Duck --ref main
  npm test
  ```

插件运行时只读本地文件，自己不发网络请求；只用 dsh 自带的三个包（`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-llm`），没有别的依赖。

## 测试

| 命令 | 要什么 | 测什么 |
|---|---|---|
| `npm test` | Node 22 以上 | 单元测试和打包检查，不需要 dsh |
| `node tests/dsh/check.mjs --route pnpm --web`（或 `--route patch`、`--route ui`） | Node 22.15 以上（读会话日志要 zstd），装好的 dsh；`pnpm` 和 `ui` 两条还要 PATH 上有 pnpm | 在临时 HOME 里按三种方式装、用、卸，读真实的会话日志核对注入的内容和位置。不需要也不使用 API key，模型请求发出前就停下 |
| `node tests/e2e/flow.cjs [main\|more\|loop\|paper]` | Node 22.15 以上，`DEEPSEEK_API_KEY`，dsh 的 headless profile 里装好插件 | 真模型跑 Doctor Duck 的整套学生流程，检查项和 Claude Code、Codex 版相同。花真钱 |

`check.mjs` 建议在断网的环境里跑（例如 `unshare -rn`，打开 loopback），这样能确认没有东西出本机。

## 验证了什么，没验证什么

细节在 [docs/验证记录.md](docs/验证记录.md)。简单说：

- 验证了：dsh 0.2.1-rc.2 和 rc.3 上三种安装方式都能装上、卸掉（卸掉后不再加载）；命令在 Web 和 headless 里都列出来、指向真实文件；开场说明和 Doctor Duck 开场 hook 的输出逐字相同，位置在学生消息之后、命令之前；续接会话不重复给，开关变了给替换的一份；照 dsh 建子代理会话的写法、用被测 dsh 的代码建出会话，插件认得出子代理（dsh 真建子代理时这么写，是读代码确认的）。
- 没验证：真模型下的效果（要 DeepSeek 的 key）；Desktop（只有 macOS、Windows 版，这台机器是 Linux）；插件页的点击流程本身（测的是它调用的后端接口），插件的「配置」页也没看过；对话压缩后重发、真跑一个子代理时不带（触发它们要真模型）。

## 许可

- 插件代码（`index.js`、`lib/`、`scripts/`、`tests/`）：MIT。
- 文档和展示文字（`README.md`、`docs/`、`locale/`）：CC BY-NC-SA 4.0，和 Doctor Duck 的文字一样（里面有改写自 Doctor Duck 的段落）。
- `duck/`：Doctor Duck 原样拷贝，按它自己的 `duck/LICENSE` 分目录许可：文字（skills/、rules/、cards/、handbook/）是 CC BY-NC-SA 4.0，不可商用；`library/` 里的原技能各自保留原来的许可（CC BY 4.0 或 CC BY-NC-SA 4.0）；代码是 MIT。
- Doctor Duck 改编自 [Supervisor-Skills](https://github.com/HKUSTDial/Supervisor-Skills)（骆昱宇及贡献者，CC BY-NC-SA 4.0）。

详见 [LICENSE](LICENSE)。
