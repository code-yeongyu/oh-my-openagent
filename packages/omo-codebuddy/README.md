# @oh-my-opencode/omo-codebuddy

The CodeBuddy adapter for [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent):
omo as a CodeBuddy plugin.

## Build

```bash
bun scripts/build-plugin.mjs           # bundle hooks, sync skills, generate agents/commands/mcp
bun scripts/build-plugin.mjs --check   # verify the checked-in artifacts are current
```

## Load in CodeBuddy

With a CodeBuddy Code install (the agent CLI — not the IDE launcher, which has
no `plugin` subcommand):

```bash
codebuddy plugin validate "$PWD/packages/omo-codebuddy/plugin"
codebuddy --plugin-dir "$PWD/packages/omo-codebuddy/plugin"
```

`--plugin-dir` loads the plugin for one session and takes precedence over an
installed marketplace copy. Inside a session, `/reload-plugins` picks up a
rebuild without restarting.

In the IDE, install it through the local marketplace created by the installer
below (`/plugin marketplace add <path>`, then `/plugin install omo@omo-local`).

## Install persistently

```bash
node scripts/install-local.mjs install --scope user     # -> ~/.codebuddy
node scripts/install-local.mjs uninstall --scope user
```

The installer materializes a local marketplace (`~/.codebuddy/plugins/omo-local`)
that points at this checkout and registers it in the scope's settings file.
Pass `--root <dir>` to install into a throwaway profile (that is what QA does),
and `--copy` to copy instead of symlinking.

## What ships

- **Hooks** — ultrawork mode + skill pointers (`UserPromptSubmit`), continuation
  of unfinished omo work (`Stop`), comment checking (`PostToolUse`), memory and
  workflow hints (`SessionStart`).
- **Skills** — the shared omo skill pool (18 skills incl. the `ultrawork`
  directive), adapted for CodeBuddy.
- **Agents** — `oracle`, `explore`, `librarian`, `multimodal-looker`, `metis`,
  `momus`, `prometheus`, extracted from omo's own agent sources.
- **Commands** — `/omo:ulw-plan`, `/omo:ulw-execute`, `/omo:ulw-loop`,
  `/omo:ulw-research`, `/omo:review-work`, `/omo:init-deep`, `/omo:remember`,
  `/omo:remove-ai-slops`, `/omo:debugging`.
- **MCP** — `context7` and `grep_app` (remote); `lsp` / `ast-grep` when their
  runtime is staged under `plugin/runtime/`.

See [`AGENTS.md`](AGENTS.md) for the full harness contract, behaviour details,
scope and known gaps.
