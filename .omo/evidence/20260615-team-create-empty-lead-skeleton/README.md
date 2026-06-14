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
- stale `team_create requires exactly one of teamName or inline_spec` validation error absent.

## QA boundary

`bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check` partially passed but reported `missing dependency: sqlite3`, so the DB-specific dependency check could not fully complete on this machine. The helper still confirmed DB path resolution, SQL escaping, free-port allocation, and isolated XDG sandbox cleanup. The separate `server-smoke.sh` OpenCode QA passed and is recorded in `server-smoke.txt`.
