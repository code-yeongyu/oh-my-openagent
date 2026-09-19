# omo-codebuddy

CodeBuddy adapter for oh-my-openagent: ships omo as a CodeBuddy plugin
(`.codebuddy-plugin/plugin.json` + `hooks/` + `agents/` + `skills/` +
`commands/` + `.mcp.json`).

**Generated artifacts live under `plugin/` and are gitignored** (`skills/`,
`agents/`, `commands/`, `hooks/scripts/`, `.mcp.json`). The hand-written plugin
surface is `plugin/.codebuddy-plugin/plugin.json`, `plugin/hooks/hooks.json` and
`plugin/README.md`. Rebuild everything with `bun scripts/build-plugin.mjs`.

## STOP. CodeBuddy QA IS MANDATORY FOR ANY EDIT IN THIS PACKAGE

A change here reaches a real CodeBuddy session. **"It typechecks" is not QA and
`bun test` being green is not QA.** Run the `codebuddy-qa` skill
(`.agents/skills/codebuddy-qa/`) and write its evidence under
`.omo/evidence/<YYYYMMDD>-<slug>/`. No evidence file means the QA did not
happen, and you may not commit or push.

**ISOLATE THE INSTALL.** QA installs into a throwaway `--root` (never the real
`~/.codebuddy`) and asserts the real settings file is byte-identical before and
after (shasum). Never QA against the user's live CodeBuddy profile.

## LAYOUT

| Path | Purpose |
|---|---|
| `package.json` | Private workspace package `@oh-my-opencode/omo-codebuddy`; scripts `build`, `build:check`, `install:local`, `uninstall:local`, `typecheck`, `test`. |
| `src/protocol/` | The CodeBuddy hook protocol (stdin payload shapes, stdout JSON, exit-code semantics). Single source of truth; every hook reads the contract from here. |
| `src/hooks/` | Hook logic: `user-prompt-submit` (ultrawork + skill pointers), `stop` (continuation), `post-tool-use` (comment checker), `session-start` (memory + workflow hints), `cli.ts` (one bundle, four commands). |
| `resources/commands/` | Hand-authored slash-command wrappers, copied verbatim into `plugin/commands/`. |
| `scripts/` | `build-plugin` (entry), `build-hooks` (bun bundle), `sync-skills`, `generate-agents`, `generate-commands`, `generate-mcp`, `validate-plugin`, `install-local` (CLI). |
| `plugin/` | The CodeBuddy plugin. Load with `codebuddy --plugin-dir <abs path>`; validate with `codebuddy plugin validate <abs path>`. |
| `test/` | Protocol, hook and generator tests (`bun test`). |

## HARNESS CONTRACT (verified, do not re-derive)

| Fact | Value |
|---|---|
| Plugin manifest | `.codebuddy-plugin/plugin.json`; only `name` is mandatory; `commands`/`agents`/`skills`/`hooks`/`mcpServers` may be paths or inline. Component dirs must live at the plugin ROOT (only the manifest may be inside `.codebuddy-plugin/`). |
| Hook config | `hooks/hooks.json` with the same shape as `settings.json` `hooks`; plugin hooks MERGE with user/project hooks and are exempt from the `allowUntrustedFrontmatterHooks` gate. |
| Hook events used | `SessionStart`, `UserPromptSubmit`, `PostToolUse` (matcher on `tool_name`), `Stop`. CodeBuddy also supports 22 more events (26 total), including `SubagentStop`, `PreCompact`, `PostCompact`, `PostToolUseFailure`. |
| Hook stdin | `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `generation_id` + event fields (`prompt`; `tool_name`/`tool_input`/`tool_response`; `stop_hook_active`; `source`). |
| Hook stdout | `{"continue": bool, "reason"/"stopReason": str, "suppressOutput": bool, "systemMessage": str, "hookSpecificOutput": {"hookEventName", "additionalContext", "permissionDecision", "permissionDecisionReason", "modifiedInput", "updatedToolOutput"}}`. `decision: "block"` is DEPRECATED — use `continue: false`. |
| Exit codes | `0` ok (stdout enters context for `SessionStart`/`UserPromptSubmit`); `2` block (stdout wins over stderr); anything else is a non-blocking warning. |
| Env | `${CODEBUDDY_PLUGIN_ROOT}` (install dir), `${CODEBUDDY_PLUGIN_DATA}` (persistent dir), `${CODEBUDDY_PROJECT_DIR}` (workspace root); `${CLAUDE_*}` aliases also work. Variables are substituted inside skills/commands/agents/hooks/MCP config AND exported to hook subprocesses. |
| Agents frontmatter | `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation`. Plugin agents do NOT support `hooks`, `mcpServers`, `permissionMode`. |
| Skills | `skills/<name>/SKILL.md`; frontmatter `name` + `description` (the description carries the triggers); `allowed-tools` and `disable` optional. |
| Commands | `commands/*.md`; frontmatter `description`, `argument-hint`; `$ARGUMENTS` in the body. Namespaced as `/omo:<name>`. |
| MCP | `.mcp.json` at the plugin root (`mcpServers`); `${CODEBUDDY_PLUGIN_ROOT}` may appear in `command`/`args`. |
| Tool-name aliases | CLI style (`Read`/`Write`/`Edit`/`Bash`/`Grep`/`Glob`/`Task`) and IDE style (`read_file`/`write_to_file`/`replace_in_file`/`execute_command`/`search_content`/`list_dir`/`task`) are matched bidirectionally; the payload's `tool_name` depends on which surface is running, so hooks must accept BOTH. |

## BEHAVIOUR (what ships)

- **Ultrawork** — `UserPromptSubmit` matches `ultrawork` / `ulw` word-bounded
  (quoted regions blanked) but NOT the workflow prefixes (`ulw-plan`,
  `ulw-research`, `ulw-loop`, `ulw-execute`), then injects the binding bootstrap
  pointing at the bundled `ultrawork` skill. Skipped when the transcript already
  carries `<ultrawork-mode>` or the session is under context pressure.
- **Skill pointers** — mentioning `ulw-plan` / `ulw-loop` / `ulw-research` /
  `mass-ulw` (incl. `mulw`, `meth`) injects one conditional pointer per skill,
  each teaching the `/omo:<skill>` invocation and the bundled file path.
  `ulw-research` also drags its `ultimate-browsing` companion. Dedup:
  an explicit `/omo:<skill>` invocation, an expanded `<skill name="…">` block,
  or the same pointer already present in the transcript.
- **Continuation** (`Stop`) — two producers, in order: a continuable
  `.omo/boulder.json` work owned by `codebuddy:<session>` with a live checklist,
  then an unfinished `.omo/ulw-loop/<session>/goals.json`. Each is budgeted at
  `STOP_RESUME_CAP` resumes **without progress** (signature = checklist /
  goal completion counts); progress resets the counter, and a `.stuck` marker is
  written when the cap is hit. `stop_hook_active: true` and context pressure
  always bail out.
- **Comment checker** (`PostToolUse`) — maps the harness tool aliases onto the
  shared `@oh-my-opencode/comment-checker-core`, then reports findings as
  `additionalContext`. Silent when the checker binary is absent
  (`OMO_COMMENT_CHECKER_BINARY`, `<CODEBUDDY_PLUGIN_DATA>/bin/comment-checker`,
  or the `@code-yeongyu/comment-checker` package).
- **Session start** — injects the project's `.codebuddy/omo-memory.md` verbatim
  (the memory layer; written through `/omo:remember`) plus a workflow hint list.

## AGENTS

Generated from omo's own agent sources by `scripts/generate-agents.mjs`
(extracted template literals, runtime interpolations dropped and reported):
`oracle`, `explore`, `librarian`, `multimodal-looker`, `metis`, `momus`,
`prometheus`.

**`sisyphus`, `hephaestus`, `atlas` and `sisyphus-junior` are deliberately NOT
exported**: they are primary agents whose prompts are assembled at runtime from
model metadata, tool tables and category lists, so a static export would ship a
degenerate prompt pretending to be the real one.

## SCOPE (v1) AND KNOWN GAPS

- Memory is the file-based `.codebuddy/omo-memory.md` layer, not the
  `memory-core` engine used by the Senpi adapter.
- MCP: `context7` + `grep_app` are always declared. `lsp` and `ast-grep` are
  declared only when their runtime is staged under `plugin/runtime/`
  (`generate-mcp.mjs` checks the filesystem); staging them is a follow-up, so a
  default build ships the two remote servers.
- No `PreCompact`, `SubagentStop`, `PostToolUseFailure` or telemetry hooks yet.
- Team mode, background agents, `boulder` CLI and the task engine are NOT ported:
  CodeBuddy's own `task`/`background_task` subagents fill that role.

## QA

```sh
# hermetic gate (CI)
bun test packages/omo-codebuddy
bun scripts/build-plugin.mjs          # build
bun scripts/build-plugin.mjs --check  # verify generated artifacts are current
bunx tsgo --noEmit -p packages/omo-codebuddy/tsconfig.json

# live gate — run the codebuddy-qa skill
node .agents/skills/codebuddy-qa/scripts/drive.mjs --self-test
node .agents/skills/codebuddy-qa/scripts/drive.mjs hooks          # built bundle, real payloads
node .agents/skills/codebuddy-qa/scripts/drive.mjs format-parity  # vs installed marketplaces
node .agents/skills/codebuddy-qa/scripts/drive.mjs install        # throwaway-root install cycle
node .agents/skills/codebuddy-qa/scripts/drive.mjs isolation      # real profile digests
```

**The agent CLI is `@tencent-ai/codebuddy-code`** (bin `codebuddy`/`cbc`); the
`~/.codebuddy/bin/buddycn` shim is the IDE launcher (a VS Code fork) and has NO
`plugin` subcommand — `codebuddy plugin validate` through it is a no-op that
exits 0. `drive.mjs probe` distinguishes the two (`agentCliAvailable`). With the
real CLI, run the full lifecycle against a throwaway `--home`:

```sh
D=.agents/skills/codebuddy-qa/scripts/drive.mjs
node "$D" probe                                                   # validate + CLI identity
node "$D" cli --home "$TMP" --args "plugin marketplace add $TMP/.codebuddy/plugins/omo-local"
node "$D" cli --home "$TMP" --args "plugin install omo@omo-local"
node "$D" cli --home "$TMP" --args "plugin list --json"
node "$D" cli --home "$TMP" --args "plugin uninstall omo@omo-local"
```

`validate` / `marketplace add` / `install` / `list` / `uninstall` need NO
authentication; a live TURN does (the CLI answers
`Authentication required. Please use /login command`), so a session run is
PENDING until the operator signs in — never reported as a pass.

**Marketplace source must stay inside the marketplace root**: a symlinked
plugin dir is rejected with `Plugin source path escapes marketplace root`, which
is why `install-local.mjs` copies by default (`--link` is for layout inspection
only).

Evidence rules: write everything under `.omo/evidence/<YYYYMMDD>-<slug>/` —
what was run, what was observed, the isolation proof (throwaway `--root`, real
`~/.codebuddy/settings.json` + `known_marketplaces.json` sha256 unchanged), and
what was omitted. Live CodeBuddy QA cannot be claimed from unit tests alone.
