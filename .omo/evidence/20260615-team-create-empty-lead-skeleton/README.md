# team_create empty lead skeleton QA evidence

## Change

`team_create` inline spec normalization now treats host-injected empty optional values as absent when an otherwise empty `lead` skeleton only preserves a discriminator value such as `kind: "category"`. Existing explicit category-name shorthand, such as `lead: { kind: "quick" }`, remains supported.

## Commands run

```bash
bun install
bun test packages/omo-opencode/src/features/team-mode/team-registry/team-spec-input-normalizer.test.ts
bun test packages/omo-opencode/src/features/team-mode/team-registry/team-spec-input-normalizer.test.ts packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-spec.test.ts
bun run build
bun run typecheck:packages
bun test packages/omo-opencode/src/features/team-mode/tools/lifecycle.test.ts packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-spec.test.ts packages/omo-opencode/src/features/team-mode/team-registry/team-spec-input-normalizer.test.ts
GIT_MASTER=1 git diff --check
bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
bash .agents/skills/opencode-qa/scripts/server-smoke.sh
bash .omo/evidence/20260615-team-create-empty-lead-skeleton/team-create-opencode-run.sh
export CODEX_HOME="$(mktemp -d)/codex"; node packages/omo-codex/scripts/install-local.mjs install
codex --help
codex exec --json --dangerously-bypass-hook-trust --skip-git-repo-check --oss --local-provider ollama -C "$PWD" 'please ultrawork; respond with exactly: hook qa ok'
bun run test:codex
```

## Results

- Targeted normalizer regression after the first fix: 11 pass, 0 fail.
- Targeted normalizer + lifecycle inline spec regressions after the first fix: 30 pass, 0 fail.
- Focused regression after preserving category-name shorthand: 32 pass, 0 fail, 59 expect() calls.
- Scoped team-mode lifecycle suite after preserving category-name shorthand: 51 pass, 0 fail, 99 expect() calls.
- `bun run build`: passed and regenerated build artifacts without tracked source changes.
- `bun run typecheck:packages`: passed.
- `GIT_MASTER=1 git diff --check`: passed with no whitespace errors.
- `opencode-qa` isolated server smoke: passed. See `server-smoke.txt` in this directory.
- Real OpenCode `opencode run --format json` team-mode QA: passed. See `opencode-run-team-create.jsonl`, `team-create-assertions.txt`, and `fake-llm-team-create.log` in this directory.
- Real OpenCode DB isolation proof: passed. `db-isolation.txt` records `SELECT count(*) FROM session` before and after the isolated run, unchanged real session count, stable real DB path, and a distinct sandbox DB path.
- Isolated Codex local install QA: passed after exporting `CODEX_HOME`. See `codex-isolated-install-exported.txt` for local build install, `omo@sisyphuslabs` config registration, hook manifest coverage, and unchanged real `~/.codex/config.toml` hash during the valid isolated run.
- Codex CLI surface smoke: passed. See `codex-cli-help.txt` for the real `codex --help` command output from codex-cli 0.139.0.
- Real Codex hook firing QA: passed. See `codex-real-hook-firing.txt`; it records an isolated `CODEX_HOME`, local install, `codex exec --json --dangerously-bypass-hook-trust`, `thread.started` / `turn.started`, the hook-trust warning from Codex, and a `UserPromptSubmit` hook output injecting `<ultrawork-mode>` into the live session transcript. The same receipt records `real_config_hash_unchanged_after_rerun=yes`.
- `bun run test:codex`: passed with 336 tests, 336 pass, 0 fail. See `codex-test-gate.txt`.
- `lsp_diagnostics`: clean for `team-spec-input-normalizer.ts` and `team-spec-input-normalizer.test.ts`. The existing `lifecycle-inline-spec.test.ts` file-level LSP diagnostics still report stale type issues already contradicted by `bun run typecheck:packages` passing.

## OpenCode QA output

### Isolated server smoke

`server-smoke.txt` records the real OpenCode QA surface check:

- `GET /global/health` returned healthy `true` on opencode 1.17.6.
- `GET /doc` listed 146 documented paths.
- Unauthenticated `GET /session` returned HTTP 401.
- The helper used an isolated XDG sandbox and cleaned it up through its trap.

### Real `team_create` tool path

`team-create-opencode-run.sh` runs an isolated XDG OpenCode session with:

- a project-local `opencode.jsonc` that loads `packages/omo-opencode/src/index.ts` from this checkout;
- `team_mode.enabled: true` in the sandboxed `oh-my-openagent.json`;
- a deterministic fake OpenAI Responses API server in `fake-openai-team-create-server.mjs`;
- `opencode run --format json --model openai/gpt-fake` as the QA surface.

The run drove the changed tool path directly. `opencode-run-team-create.jsonl` contains:

- a `tool_use` event for `team_create`;
- `inline_spec.lead` with the host-style skeleton values `kind: "category"`, empty `category`, empty `subagent_type`, empty `prompt`, and empty `loadSkills`;
- a completed `team_create` output with `teamName: "team-create-empty-lead-qa"` and a generated `teamRunId`;
- a follow-up `team_list` `tool_use` event showing the active created team.

`team-create-assertions.txt` records the structured assertions:

- `team_create` tool_use emitted;
- host-style lead skeleton included in the input;
- `team_list` verification tool_use emitted;
- requested team name preserved in the result;
- stale `team_create requires exactly one of teamName or inline_spec` validation error absent;
- real OpenCode DB path stable before and after the isolated run;
- real OpenCode DB `SELECT count(*) FROM session` unchanged before and after the isolated run;
- sandbox OpenCode DB path distinct from the real DB path.

### Real DB isolation receipt

`db-isolation.txt` records the required no-pollution proof for the real OpenCode DB:

```text
real_db_query=SELECT count(*) FROM session
real_db_path_before=/home/leejunwoo/.local/share/opencode/opencode.db
real_session_count_before=4537
sandbox_xdg_data_home=/tmp/oqa-xdg.tuYrAU/data
sandbox_db_path=/tmp/oqa-xdg.tuYrAU/data/opencode/opencode.db
real_db_path_after=/home/leejunwoo/.local/share/opencode/opencode.db
real_session_count_after=4537
real_db_path_stable=yes
real_session_count_unchanged=yes
sandbox_db_distinct_from_real=yes
```

This proves the spawned `opencode run` wrote to the isolated XDG database, not the real `~/.local/share/opencode/opencode.db`.

## Codex QA output

### Isolated local Codex install

`codex-isolated-install-exported.txt` records the Codex package QA required by `packages/omo-codex/AGENTS.md` for the `packages/omo-codex/plugin/test/scaffold-plan.test.mjs` path change:

- `CODEX_HOME` was exported to a fresh temporary directory before running `node packages/omo-codex/scripts/install-local.mjs install`;
- the local plugin build installed into that sandbox and wrote a sandbox `config.toml`;
- the sandbox config registered the local `sisyphuslabs` marketplace and enabled `omo@sisyphuslabs`;
- the installed plugin cache contained hook registrations for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostCompact`, `Stop`, and `SubagentStop`;
- the real `~/.codex/config.toml` hash was unchanged before and after the valid isolated run.

`codex-invalid-attempt-note.txt` records one discarded QA attempt where `CODEX_HOME` was assigned as a shell variable but not exported. That attempt is explicitly not used as isolation proof; the exported rerun above is the valid Codex QA evidence.

### Codex CLI smoke

`codex-cli-help.txt` records a real Codex CLI surface check. It confirmed codex-cli 0.139.0 starts and exposes the expected top-level command surface, including `exec`, `review`, `plugin`, `doctor`, and `help`.

### Real Codex hook firing

`codex-real-hook-firing.txt` records the live Codex surface check requested by the Codex review:

- a fresh exported `CODEX_HOME` was installed from this checkout with `node packages/omo-codex/scripts/install-local.mjs install`;
- the sandbox config enabled `plugins`, `plugin_hooks`, and `omo@sisyphuslabs`;
- `codex exec --json --dangerously-bypass-hook-trust --skip-git-repo-check --oss --local-provider ollama -C "$PWD" 'please ultrawork; respond with exactly: hook qa ok'` started a real Codex thread and turn;
- the Codex JSONL stream recorded the hook-trust warning, proving hooks were enabled for that invocation;
- the persisted Codex session JSONL includes the `UserPromptSubmit` hook output: `hookSpecificOutput.additionalContext` begins with `<ultrawork-mode>` and references the saved hook output path;
- `real_config_hash_unchanged_after_rerun=yes` proves the real `~/.codex/config.toml` stayed untouched.

### Canonical Codex gate

`codex-test-gate.txt` records the required `bun run test:codex` gate. It rebuilt the Codex installer/plugin surfaces and ran the Codex compatibility suite, including `packages/omo-codex/plugin/test/scaffold-plan.test.mjs`; the final summary was:

```text
tests 336
pass 336
fail 0
```

## QA boundary

`bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check` partially passed but reported `missing dependency: sqlite3`. To satisfy the mandatory DB isolation proof without that local binary, `team-create-opencode-run.sh` uses OpenCode's own read-only DB surface, `opencode db "SELECT count(*) FROM session" --format json`, before and after spawning the isolated run. The separate `server-smoke.sh` OpenCode QA passed and is recorded in `server-smoke.txt`.
