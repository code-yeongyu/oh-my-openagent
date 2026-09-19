# omo for CodeBuddy

oh-my-openagent (omo) as a CodeBuddy plugin.

## What it adds

| Surface | Contents |
|---|---|
| Hooks | `SessionStart` (project memory + workflow hints), `UserPromptSubmit` (ultrawork mode + skill pointers), `PostToolUse` (comment checker), `Stop` (continuation of unfinished omo work plans) |
| Skills | the shared omo skill pool (ulw-plan, ulw-execute, ulw-loop, ulw-research, debugging, frontend, refactor, review-work, …) plus the `ultrawork` directive |
| Agents | the omo subagents (`oracle`, `explore`, `librarian`, `multimodal-looker`, `metis`, `momus`, `prometheus`) |
| Commands | `/omo:<workflow>` thin wrappers that load the matching skill with your arguments |
| MCP | `context7`, `grep_app` (remote), plus `lsp` / `ast-grep` when their local runtime is staged |

## Install (development)

```bash
codebuddy --plugin-dir /absolute/path/to/packages/omo-codebuddy/plugin
```

`--plugin-dir` can be passed more than once and takes precedence over an
installed marketplace copy for that session. Validate the manifest with:

```bash
codebuddy plugin validate /absolute/path/to/packages/omo-codebuddy/plugin
```

Reload a running session after a rebuild with `/reload-plugins`.

## Install (persistent, local marketplace)

```bash
node packages/omo-codebuddy/scripts/install-local.mjs install --scope user
```

The installer materializes a local marketplace pointing at this checkout and
registers `omo@omo-local` in the CodeBuddy settings for the chosen scope.
`uninstall` reverses exactly what `install` wrote.

## Automatic behaviors

- **ultrawork mode** — a prompt containing `ultrawork` / `ulw` (quoted regions
  excluded) injects the binding ultrawork bootstrap and points at the bundled
  `ultrawork` skill.
- **skill pointers** — mentioning `ulw-plan`, `ulw-loop`, `ulw-research`, or a
  `mass ulw` spelling injects a conditional pointer: read the skill **if** the
  user is actually asking for it.
- **continuation** — when a turn ends while an omo work plan (`.omo/boulder.json`
  work owned by this session, or an unfinished `.omo/ulw-loop/<session>/goals.json`)
  is still open, the stop is blocked with a resume directive. Continuation is
  budgeted: at most two resumes without progress, then the plugin stops asking.
- **comment checker** — after an edit-like tool call the bundled
  `comment-checker` binary (when installed) reports comment noise back to the
  model.

## Memory

Project memory lives in `.codebuddy/omo-memory.md` inside the workspace and is
injected on session start. Update it with `/omo:remember`, which appends a dated
entry instead of rewriting the file.
