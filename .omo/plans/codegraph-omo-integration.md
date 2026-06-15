# CodeGraph session-bootstrap for omo (opencode + codex) + ~/.omo config SOT + license notices

## TL;DR
> Summary:      On coding-agent session start, omo auto-bootstraps CodeGraph (init/keep-fresh the index, register its MCP server) for both the opencode and codex harnesses — detecting/provisioning the `codegraph` binary and skipping registration if that fails — with index data stored in a global `~/.omo/codegraph/` store linked into each project. Ships alongside a new `~/.omo` JSONC config SOT (per-`[harness]` overrides, codex as first consumer) and comprehensive third-party license notices.
> Deliverables: shared SOT schema/loader (`packages/utils`); shared codegraph helpers (binary-resolve, storage-prepare, env+provision); opencode codegraph MCP + `session.created` bootstrap hook + config section; codex `~/.omo` SOT loader + codegraph MCP gating + SessionStart component + install/seed; root + omo-codex `THIRD-PARTY-NOTICES.md` with ship verification.
> Effort:       XL
> Risk:         Medium - symlinked global index store, MCP-registered-before-index ordering, cross-harness isolation, and a new config SOT are each load-bearing.

## Context
### Original request
사용자: "그 ~/sionicai/pi-sionic 인가 pionic 인가 여기꺼 최신버전 한번 살펴볼래? 그리고 저기에 세션 켜질때에 codegraph init 하게하고 업데이트도 필요할때마다 하게하고 이거 정보를 로컬에 적당한 위치에 넣고서 쓰게 하고 업데이트도 잘 반영되게 하는게 들어갔는데, 이거 우리 적용해볼 수 있을까? ../opencode ../codex ../codegraph 싹 다 최신으로 git pull 받고 최신 api 최신 버전 기준으로 해서 살펴보고서 말해주라 ulw plan". 후속: codex도 애매하면 비활성, codegraph 텔레메트리 기본 off, 라이선스 전수 고지 보강, codex 설정은 settings.toml/env가 아니라 `~/.omo` 기반 새 SOT(마이그레이션 고려)로 — 하네스(codex/opencode/omo-native)별 오버라이드 + 하네스 한정 설정 힌팅 스키마까지 함께 설계. high accuracy, Momus는 codex CLI의 momus 리뷰어를 xhigh로.

### Interview summary
- **Integration via MCP route** (`codegraph serve --mcp`), NOT pi's native-tool-wrapper route. Reference = `sionic-ai/pionic-mono` `sionic-codegraph` builtin (mengmotaHost `~/sionicai/pi-sionic`, already pushed — nothing to push).
- **Binary policy** (user): detect → auto-provision → if it fails, **do NOT register the MCP** — both harnesses (codex too). Mirrors omo lsp/ast_grep `enabled: exists` + git-bash detect-skip.
- **Storage** (mirror pi): global `~/.omo/codegraph/projects/<base>-<sha256(path)[:16]>/`, project `.codegraph` symlinked (junction on win32). `CODEGRAPH_INSTALL_DIR` scoped there. **Telemetry OFF by default (forced)**.
- **Session start**: opencode `session.created` event hook + codex new SessionStart component → prepare(symlink)→provision→`status`→`init|sync` **background non-blocking**; failures never abort the session. Accepted behavior: fresh repo's first session has no codegraph tools (bg init running) → tools active from session 2.
- **Config SOT (workstream C)**: `~/.omo/config.jsonc` (+ project `.omo/config.jsonc`), **JSONC**. Override via **`[harness]` blocks** (`[codex]`/`[opencode]`/future `[omo]`), base deep-merged with the active harness block (VSCode `[language]` analogy). Schema declares which harness(es) each setting supports + warns when set under an unsupported harness. THIS plan: **foundation + codex consumption only**; opencode keeps `oh-my-openagent.json` (no migration now; types stay harness-agnostic so opencode can read SOT later). env-var override kept for back-compat during transition.
- **License (workstream B)**: comprehensive — root `THIRD-PARTY-NOTICES.md` + `packages/omo-codex/THIRD-PARTY-NOTICES.md`; audit all vendoring + fix gaps; verify NOTICE files ship in tarballs.
- **Tests**: TDD + tests-after + manual QA (all). High accuracy → Momus loop via **codex CLI at reasoning effort xhigh**.

### Research findings
- **CodeGraph v1.0.1** MCP server does NOT lazy-index — no `.codegraph/codegraph.db` ⇒ inactive, 0 tools (`src/mcp` behavior). `codegraph init` is idempotent; the daemon's native FS watcher (2s debounce) + connect-time catch-up keep the index fresh; `codegraph serve --mcp` must not be run by humans. Index dir name overridable by `CODEGRAPH_DIR` (plain name only, not absolute) → pi relocates via symlink instead. → implication: omo must run `init` itself; freshness is otherwise free.
- **Reference `sionic-codegraph/index.ts`** (537 lines): `getCodeGraphDataRoot=~/.pionic/codegraph`; `prepareCodeGraphWorkspace` makes `~/.pionic/codegraph/projects/<base>-<sha256(resolved)[:16]>` and symlinks project `.codegraph` → it (junction on win32; throws "storage blocked" if `.codegraph` is a real dir or wrong link); env `CODEGRAPH_INSTALL_DIR` + `CODEGRAPH_NO_DOWNLOAD=1`; `resolveCodeGraphCommand` 4-tier env→bundled(`require.resolve`)→provisioned(`~/.pionic/lsp/node-servers/node_modules`)→PATH; `runStartupSync` on `session_start`: prepare→(`ensureProvisionedServers` if PATH-tier & not on PATH)→`status --json`→(127⇒unavailable+return)→`init --index`|`sync --quiet`→ready, every failure = widget + return (never aborts). → implication: copy storage+provision+startup design onto MCP registration.
- **opencode** (`5d0f86606`): `createBuiltinMcps(disabledMcps,...)` (`packages/omo-opencode/src/mcp/index.ts:26`) gates each MCP `if(!disabledMcps.includes(name))`; `LocalMcpConfig {type:"local",command,enabled,environment}` with `enabled: resolvedCommand.exists` (`src/mcp/lsp.ts:161`, `src/mcp/ast-grep.ts:118`); runtime detect `resolveRuntimeExecutable` (`src/mcp/runtime-executable.ts:32`, Bun.which); final gate `applyMcpConfig` (`src/plugin-handlers/mcp-config-handler.ts:28-69`) deletes disabled. Session-once event `session.created` (`src/plugin/event.ts:141`); hooks built `src/plugin/hooks/create-session-hooks.ts:66`, dispatched `src/plugin/event-hook-dispatcher.ts:37`, copy `src/hooks/auto-update-checker/`. Config Zod schema `src/config/schema/oh-my-opencode-config.ts:31` (add section like `team-mode.ts`), loader `src/plugin-config/layered-config-loader.ts:121`, basename `oh-my-openagent`. → implication: opencode codegraph = `src/mcp/codegraph.ts` + a `session.created` hook + a Zod config section.
- **codex** (`dfd03ea01b`): static `plugin/.mcp.json` (ast_grep/grep_app/context7/git_bash/lsp); SessionStart hooks in `plugin/hooks/hooks.json` (rules/telemetry/auto-update[`^startup$`]/bootstrap), components built to `dist/cli.js`. Components read config via env ONLY today; **no shared config module**. SOT loader home → new `packages/omo-codex/plugin/shared/src/config-loader.ts` (imported by each component cli). JSONC parser reuse `packages/utils/src/jsonc-parser.ts`. `~/.omo/rules` already read (`components/rules/src/rules/constants.ts`). Seed/migrate via `plugin/scripts/auto-update.mjs` + `migrate-codex-config.mjs`. Platform-stamp precedent `scripts/install/git-bash-mcp-env.mjs`. git-bash detect-skip+hint `packages/git-bash-mcp/src/git-bash-resolver.ts:31`. codex MCP config (its own `~/.codex/config.toml` `[mcp_servers.x]`) NOT used here — we register via plugin `.mcp.json`. → implication: codex codegraph = SOT loader + `.mcp.json` entry with detection-gating + a SessionStart component + install seed.
- **License** (state): per-component NOTICE/LICENSE under `packages/omo-codex/plugin/components/{lsp,rules,comment-checker,ulw-loop,ultrawork,start-work-continuation}` + `packages/lsp-tools-mcp`; root `LICENSE.md` = SUL-1.0 w/ third-party clause; **no root aggregate**. Need notices for 13 npm deps (MCP SDK, @ast-grep/cli+napi, clack, commander, diff, js-yaml, jsonc-parser, picocolors, picomatch, posthog-node, vscode-jsonrpc, @code-yeongyu/comment-checker) + codegraph (@colbymchenry, MIT) + ported pi-lsp-client/pi-rules/pi-comment-checker (MIT). Distribution via root `package.json` `files[]`. JSONC parser `packages/utils/src/jsonc-parser.ts`.
- **Isolation**: `omo-opencode` and `omo-codex` are isolated bundles (no cross-import); both depend on `packages/utils` → shared SOT + codegraph helpers belong in `packages/utils`.

### Metis review
Metis (9 CRITICAL / 7 MINOR / 6 AMBIGUOUS). Resolutions:
- **C1/C2 (codex has NO per-session MCP gate — enablement is install-time in `~/.codex/config.toml` via `scripts/install/config.mjs ensurePluginMcpEnabled`; git_bash is platform+install-time+soft-prompt, NOT a detect-skip precedent)** → USER DECISION (conditional): IF codex tolerates a failing `required=false` MCP gracefully → unify on **git_bash style: always-declare codegraph in `.mcp.json` with `required=false` + a soft prompt**, binary absence ⇒ codex skips the failed spawn, no broken session. IF NOT → SessionStart rewrites `config.toml` `enabled`. **VERIFIED & RESOLVED: codex tolerates a `required=false` MCP failure gracefully** — non-required servers are spawned, failures logged as `McpStartupUpdateEvent`, and only `required_servers` block `validate_required_servers()` (`codex-rs/codex-mcp/src/connection_manager.rs:140-144,287-327`; `config/src/mcp_types.rs:141-143`; test `exec/tests/suite/mcp_required_exit.rs`). → **git_bash style chosen**: declare codegraph in `.mcp.json` with `required=false` + a serve-wrapper that exits non-zero when the binary is unresolvable (codex logs+skips, session unaffected) + a soft prompt. NO config.toml rewrite; git_bash unchanged. My false "git-bash detect-skip" reference is removed.
- **C3 (codegraph self-installer writes `~/.codex/config.toml` + `~/.codex/AGENTS.md`)** → GUARDRAIL: hook invokes ONLY `status`/`init`/`sync`, NEVER `install`/`serve`; add QA asserting those files are byte-unchanged after the hook.
- **C4 (env var was WRONG: `CODEGRAPH_INSTALL_DIR` = binary cache, NOT index store; index store hardcoded to project `.codegraph/`; `CODEGRAPH_DIR` = rename-only, single segment, no absolute → cannot relocate)** → FOLDED FIX: relocate index via symlink ONLY; set `CODEGRAPH_INSTALL_DIR=~/.omo/codegraph` for the binary cache; do not rely on any env var to move the index.
- **C5/C6 (real `.codegraph/codegraph.db` here is ~5 GB + live daemon.sock; global store accretes multi-GB/project with no GC; cross-volume junction fails; socket ~104-char limit → tmpdir fallback; worktrees hash to DIFFERENT stores)** → AWAITING USER (Q: storage model). If global kept: add size/GC guard + same-filesystem check + cross-volume in-place fallback.
- **C7 (MCP registered-but-unindexed)** → USER DECISION: **binary-exists** gate (NOT index-exists). The plugin ALWAYS runs `init`/`sync` itself, so only the binary must exist. Safe because codegraph's MCP server, when the index is absent, advertises **inactive / "not initialized" guidance — NOT empty results** (verified: codegraph CLI lane), so the model is not misled; it just uses Read until init completes (the accepted session-2 window).
- **STORAGE (C4/C5/C6)** → USER DECISION (adoption rule): **if the project ALREADY has a real `.codegraph/` → use it in-place (no symlink, no move); if absent → create the global `~/.omo/codegraph/projects/<slug>/` store + symlink the project `.codegraph` to it (junction on win32).** Fallbacks: junction/symlink failure or cross-volume ⇒ create a real in-place `.codegraph/` instead (never abort). This auto-handles this repo's existing ~5 GB `.codegraph/` (stays in-place). Global store gets a size/GC guard + same-filesystem check before symlinking. Index relocation is via symlink ONLY (env vars can't); `CODEGRAPH_INSTALL_DIR=~/.omo/codegraph` scopes the binary cache.
- **C8 (provision concurrency: bootstrap lock is per-plugin-version, not per-resource)** → FOLDED: codegraph gets its OWN per-host provisioning lock + idempotent completion marker.
- **C9 (license scope bigger: codegraph pulls 6 platform pkgs + vendored Node 24 + tree-sitter WASM grammars; ast-grep binary 0.42.3 also un-noticed; SUL-1.0 makes NOTICES a compliance requirement)** → FOLDED: enumerate the REAL set (codegraph + platform pkgs + vendored Node + grammars + ast-grep + npm deps) before writing NOTICES.
- MINOR folded: M1 `~/.omo` namespace + project `.omo/*` is gitignored (project `.omo/config.jsonc` would be ignored — use `.git/info/exclude` or document); M2 add `.codegraph` to project gitignore/exclude; M3 adoption of pre-existing real `.codegraph` (this repo!) — detect real dir → skip-symlink/use-in-place, never destroy; M4 harness identity is PASSED explicitly by each bundle (not auto-sniffed); M5 precedence order written (see below); M6 telemetry off knob = `CODEGRAPH_TELEMETRY` exact off-value, forced in spawned env; M7 daemon idle-timeout/NO_DAEMON/NO_WATCH lifecycle pinned.
- AMBIGUOUS defaults applied: A1 pin `@colbymchenry/codegraph@1.0.1` (scoped name — goal's "colbymchenry/codegraph" was the repo); A2 provision via ast-grep-style checksummed GitHub-release download (manifest+sha256), NOT runtime `npm i` (avoids self-installer + optionalDeps mirror bug); A3 only `status`/`init`/`sync` at startup; A4 sanitize `<base>` to `[A-Za-z0-9._-]` (mirror git-bash safePathSegment); A5 junction on win32 + cross-volume fallback; A6 shared types model ONLY codex's current needs + extensible (no opencode mapping pre-built).
- Precedence (M5, decided): built-in defaults < `~/.omo` base < `~/.omo` `[harness]` < project `.omo` base < project `.omo` `[harness]` < env override (back-compat; env wins during transition, documented as temporary).
- Scope-creep watch (Metis): NO opencode migration; license list ENUMERATED not open-ended; codegraph's claude/cursor/gemini installer targets OUT.

## Scope
### Must have
- On opencode session start, when `codegraph` is resolvable/provisionable: the project index is prepared per the adoption rule (in-project `.codegraph` if it already exists, else the global `~/.omo/codegraph/projects/<slug>/` store + symlink) and `init`/`sync` runs in the background non-blocking; the codegraph MCP is registered with `enabled: <binary resolvable>` and serves tools once the index exists.
- On codex session start: the same prepare/provision/init behavior via a new SessionStart component; the codegraph MCP is **declared in `.mcp.json` with `required=false`** and launched through a serve-wrapper that exits non-zero when the binary is unresolvable — so when detection/provision fails codex logs the failure and skips the server (no broken/active MCP), per the verified `required=false` graceful-skip behavior.
- Both harnesses degrade safely when `codegraph` cannot be detected AND auto-provision fails: opencode omits the MCP (`enabled:false`); codex's `required=false` wrapper exits non-zero so codex skips it. Either way there is no broken/inactive server and the session proceeds normally.
- CodeGraph telemetry OFF by default (env forced).
- A `~/.omo/config.jsonc` SOT with `[harness]` override blocks (JSONC), a loader+resolver in `packages/utils`, harness-applicability metadata + warnings, consumed by the codex side for codegraph config; env-var back-compat preserved.
- Root `THIRD-PARTY-NOTICES.md` + `packages/omo-codex/THIRD-PARTY-NOTICES.md` covering all vendored deps + codegraph + ported code; verified to ship in the published tarballs.
- TDD (RED→GREEN) for every shared helper + a tests-after layer + agent-executed manual QA on the real opencode and codex harnesses for every success criterion.

### Must NOT have (guardrails)
- No forking/patching CodeGraph itself; no running `codegraph serve --mcp` by hand in tests.
- No opencode config migration to `~/.omo` in this plan (opencode keeps `oh-my-openagent.json`); SOT consumption on the opencode side is OUT (types stay harness-agnostic only).
- No pi/pionic harness work; no Claude Code (omocc) distribution changes.
- No writing tracked project files other than the `.codegraph` symlink; the only allowed untracked project-local metadata write is adding `.codegraph` to `.git/info/exclude` as specified in Todo 3. Never throw out of a session-start path (failures are logged/widgeted, never fatal).
- No cross-import between `omo-opencode` and `omo-codex` bundles (shared code goes in `packages/utils`).
- Do not touch the untracked build artifacts under `packages/oh-my-openagent-*/bin/` (dirty_worktree) — out of every task's scope.
- No `as any`, empty catches, debug prints, or dead code; respect the 250-LOC module ceiling.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: **TDD** for `packages/utils` shared helpers + per-component logic (framework: `bun test` / vitest as the package uses) **plus tests-after** for wiring; **manual QA always**.
- QA policy: every todo has agent-executed scenarios through a real surface — opencode via `opencode run --format json` / server+SSE / tmux, ALWAYS in an isolated XDG sandbox with a before/after `opencode.db` session-count proof (AGENTS.md §OPENCODE rules 1-2 / `opencode-qa` skill — never pollute the real `~/.local/share/opencode/opencode.db`); codex via the plugin hook CLI (`node .../dist/cli.js hook session-start`) and a real codex run under an isolated `CODEX_HOME`; config/DB/symlink shaped work via CLI stdout + filesystem/state diff + parsed config dump.
- Evidence for this branch is consolidated under `.omo/evidence/20260615-codegraph-omo-integration/`.
  Root `.omo/evidence/task-*` files are local ignored scratch artifacts only and must not appear in the PR diff.
- **QA shell + invocation conventions (apply to every scenario below):**
  - All `tmux` QA panes are created running **fish** (`tmux new-session -d -s <name> -x 200 -y 50 fish`) so the fish syntax in the steps (`set x (cmd)`, `for i in (seq ..); ..; end`, `$status`, `math`) runs as written. (Momus accepts an explicit shell; the host shell is fish.)
  - `packages/utils` is **ESM with NO build** (`package.json` `exports → ./src/index.ts`, `"type":"module"`, deps only `js-yaml`+`jsonc-parser`). Therefore: NEVER `require('./packages/utils/src/index.ts')`; run inline checks with **`bun`** importing source — `bun -e 'const m = await import("./packages/utils/src/index.ts"); ...'` — and put utils tests **co-located** at `packages/utils/src/<name>.test.ts`, run via `cd packages/utils && bun test src/<name>.test.ts` (matches its `bun test src/*.test.ts` script). Do NOT add a runtime validator dep (no zod/typebox) to `packages/utils`.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 in a non-final wave = under-splitting.
Wave 1 (no deps): 1 SOT schema/types · 2 codegraph binary-resolve · 3 codegraph storage-prepare · 4 codegraph env+provision · 5 root NOTICES · 6 codex NOTICES+audit
Wave 2 (after W1): 7 SOT loader/[harness] resolver (after 1) · 10 opencode codegraph config schema (after 1) · 11 license ship-verify (after 5,6)
Wave 3 (after W2): 8 opencode codegraph MCP (after 2,3,4,10) · 9 opencode session.created bootstrap hook (after 2,3,4,10) · 12 codex shared SOT loader + shared-pkg scaffold (after 7)
Wave 4 (after W3): 13 codex codegraph component scaffold + .mcp.json entry + serve-wrapper + workspaces[] registration (after 2,4,12)
Wave 5 (after W4): 14 codex codegraph SessionStart cli/hook + hooks.json (after 3,4,12,13)
Wave 6 (after W5): 15 codex install/seed SOT+migration (after 12,14)
Critical path: 1 → 7 → 12 → 13 → 14 → 15 → F-wave (the codex component chain 13→14→15 shares one component dir + build registration, so it is inherently sequential — not a splitting defect)
### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
|---|---|---|---|
| 1 | none | 7,10 | 2,3,4,5,6 |
| 2 | none | 8,9,13 | 1,3,4,5,6 |
| 3 | none | 8,9,14 | 1,2,4,5,6 |
| 4 | none | 8,9,13,14 | 1,2,3,5,6 |
| 5 | none | 11 | 1,2,3,4,6 |
| 6 | none | 11 | 1,2,3,4,5 |
| 7 | 1 | 12 | 10,11 |
| 8 | 2,3,4,10 | F | 9,12 |
| 9 | 2,3,4,10 | F | 8,12 |
| 10 | 1 | 8,9,F | 7,11 |
| 11 | 5,6 | F | 7,10 |
| 12 | 7 | 13,14,15 | 8,9 |
| 13 | 2,4,12 | 14,F | — |
| 14 | 3,4,12,13 | 15 | — |
| 15 | 12,14 | F | — |

## TODOs
> Implementation + its test = ONE todo. Never separate them.

- [x] 1. SOT schema + types + harness-applicability metadata (`packages/utils`)
  **What to do**: Create `packages/utils/src/omo-config.ts` defining the `~/.omo` SOT type system: a base `OmoConfig` object with a `codegraph` section (`enabled?: boolean`, `install_dir?: string`, `watch_debounce_ms?: number`, `auto_provision?: boolean`, `telemetry?: boolean`); the `[harness]` override blocks typed as optional keys `"[codex]" | "[opencode]" | "[omo]"` each holding a partial `OmoConfig`; and per-setting **harness-applicability metadata** (a `SETTING_HARNESS_SUPPORT` map declaring which harnesses each setting key supports, default all). Export: the plain TS `OmoConfig` type, the `HarnessId` union (`"codex"|"opencode"|"omo"`), `HARNESS_IDS`, and a **hand-rolled `validateOmoConfig(value): { ok: boolean; errors: string[] }`** — NO runtime schema library (`packages/utils` depends only on `js-yaml`+`jsonc-parser`; adding zod/typebox is forbidden). The opencode Zod mirror of this same shape lives in todo 10 (omo-opencode already depends on zod). Tests (TDD, RED first, co-located `packages/utils/src/omo-config.test.ts`): `validateOmoConfig` returns `ok:true` for a valid base+`[codex]`+`[opencode]` doc; `ok:false`+errors for an unknown harness block key (e.g. `[android]`); the applicability map exposes codegraph keys; a harness-only setting is flagged. Keep ≤250 LOC; split metadata into a sibling file if needed.
  **Must NOT do**: No loader/IO here (pure types + validator). No opencode-specific or codex-specific imports. No `as any`. Do NOT add zod/typebox or any runtime validator dependency to `packages/utils`.
  **Parallelization**: Wave 1 | Blocks: 7,10 | Blocked by: none
  **References**:
  - `packages/utils/src/jsonc-parser.ts` - the package that will host this; match its ESM export style + tsconfig. CONFIRMED: `packages/utils/package.json` deps are only `js-yaml`+`jsonc-parser` and it is ESM-no-build (`exports → ./src/index.ts`) — so hand-roll the validator, do NOT add a validator dep.
  - `packages/omo-opencode/src/config/schema/team-mode.ts` - the field SHAPE (defaults, optional) to mirror in the TS type; the Zod encoding of this shape is todo 10 (opencode side), not here.
  - `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts:31` - how a section composes into a larger schema (for opencode's later read-only consumption; keep types compatible).
  - draft `.omo/drafts/codegraph-session-bootstrap.md` (SOT DESIGN section) - the locked `[harness]`/JSONC/applicability decisions and WHY (axis = harness not OS).
  **Acceptance criteria**:
  - [ ] `bun test packages/utils` (or the package's test cmd) -> the new omo-config tests pass (RED→GREEN documented).
  - [ ] `bun -e "const {validateOmoConfig}=await import('./packages/utils/src/index.ts'); process.exit(validateOmoConfig({codegraph:{enabled:true},'[codex]':{codegraph:{enabled:false}}}).ok?0:1)"` -> exit 0 (valid doc accepted).
  - [ ] `bun -e "const {validateOmoConfig}=await import('./packages/utils/src/index.ts'); process.exit(validateOmoConfig({'[android]':{}}).ok?1:0)"` -> exit 0 (unknown harness block ⇒ ok:false).
  **QA scenarios**:
  - Scenario: valid base + harness blocks parse and types resolve
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task1 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task1 'cd /Users/yeongyu/local-workspaces/omo && bun test packages/utils 2>&1 | tee .omo/evidence/task-1-sot-schema.txt' Enter`
      3. poll: `for i in (seq 1 60); test -s .omo/evidence/task-1-sot-schema.txt; and grep -qE "pass|fail" .omo/evidence/task-1-sot-schema.txt; and break; tmux capture-pane -t ulw-qa-task1 -pS -E - >> .omo/evidence/task-1-sot-schema.txt; end`
    Expected: output contains the omo-config test names and `0 fail` (or framework's all-pass marker).
    Capture: the `tee` in step 2 writes `.omo/evidence/task-1-sot-schema.txt`.
    Cleanup: `tmux kill-session -t ulw-qa-task1`; verify `tmux ls 2>/dev/null | grep -c ulw-qa-task1` is `0`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-1-sot-schema.txt
  - Scenario: unknown harness block + harness-only setting misuse are rejected/flagged
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task1e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task1e "cd /Users/yeongyu/local-workspaces/omo && bun -e \"const {validateOmoConfig}=await import('./packages/utils/src/index.ts'); console.log(validateOmoConfig({'[android]':{}}).ok?'NO_REJECT':'REJECTED')\" | tee .omo/evidence/task-1-sot-schema-error.txt" Enter`
      3. poll for file non-empty (same loop shape as above)
    Expected: file contains `REJECTED`.
    Capture: the `tee` in step 2.
    Cleanup: `tmux kill-session -t ulw-qa-task1e`; verify `tmux ls` has no `ulw-qa-task1e`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-1-sot-schema-error.txt
  **Commit**: Y | `feat(utils): add ~/.omo config SOT schema with [harness] overrides` | Files: packages/utils/src/omo-config.ts (+ sibling metadata), packages/utils/src/omo-config.test.ts

- [x] 2. CodeGraph binary resolver + detection (`packages/utils`)
  **What to do**: Create `packages/utils/src/codegraph/resolve.ts` porting pi's `resolveCodeGraphCommand` 4-tier logic, harness-agnostic: tier 1 env override (`OMO_CODEGRAPH_BIN`), tier 2 bundled (`require.resolve("@colbymchenry/codegraph/package.json")` → npm-shim/bin), tier 3 provisioned (a configurable prefix dir, default `~/.omo/codegraph` node-servers area), tier 4 PATH `codegraph`. Inject the node-runtime resolver + `which` so callers (opencode `Bun.which`/`resolveRuntimeExecutable`, codex `resolveNodeRuntime`) pass their own. Return `{command, argsPrefix, source: "env"|"bundled"|"provisioned"|"path", exists: boolean}` where `exists` is the gate both harnesses use. Tests (TDD): each tier selected given fakes; `exists=false` only when all tiers fail and the PATH command is absent.
  **Must NOT do**: No auto-install here (that's todo 4). No spawning `codegraph serve --mcp`. No harness-specific `which`/runtime hardcoded — inject it.
  **Parallelization**: Wave 1 | Blocks: 8,9,13 | Blocked by: none
  **References**:
  - mengmotaHost `~/sionicai/pi-sionic/.../sionic-codegraph/index.ts:203-217` (`resolveCodeGraphCommand`) - the exact 4-tier order + return shape to port (read via `ssh mengmotaHost`); WHY: proven design, keeps parity.
  - `packages/omo-opencode/src/mcp/runtime-executable.ts:32` (`resolveRuntimeExecutable`) - the opencode-side injectable detector (Bun.which) the resolver must accept.
  - `packages/omo-opencode/src/mcp/lsp.ts:135-172` - how `exists` flows into `enabled` on a `LocalMcpConfig`; WHY: todo 8 consumes this.
  - `packages/git-bash-mcp/src/git-bash-resolver.ts:31-83` - the detect-tiers → `found:false`+installHint template for the skip path.
  **Acceptance criteria**:
  - [ ] `bun test packages/utils` -> resolve.ts tests pass (all 4 tiers + exists gate).
  - [ ] `bun -e "const {resolveCodegraphCommand}=await import('./packages/utils/src/index.ts'); const r=resolveCodegraphCommand({which:()=>null, requireResolve:()=>{throw 0}, provisioned:()=>null}); console.log(r.source, r.exists)"` -> prints `path false`.
  **QA scenarios**:
  - Scenario: real environment resolution reports a concrete source
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task2 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task2 "cd /Users/yeongyu/local-workspaces/omo && bun -e \"const {resolveCodegraphCommand}=await import('./packages/utils/src/index.ts'); console.log(JSON.stringify(resolveCodegraphCommand()))\" | tee .omo/evidence/task-2-resolve.txt" Enter`
      3. poll file non-empty (loop shape from task 1)
    Expected: JSON with a `source` in {env,bundled,provisioned,path} and a boolean `exists` (matches whether `codegraph` is actually installed on this machine — cross-check `which codegraph`).
    Capture: the `tee` in step 2.
    Cleanup: `tmux kill-session -t ulw-qa-task2`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-2-resolve.txt
  - Scenario: all tiers fail → exists:false (skip signal)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task2e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task2e "cd /Users/yeongyu/local-workspaces/omo && bun -e \"const {resolveCodegraphCommand}=await import('./packages/utils/src/index.ts'); const r=resolveCodegraphCommand({which:()=>null,requireResolve:()=>{throw 0},provisioned:()=>null}); console.log(r.exists===false?'SKIP':'REGISTER')\" | tee .omo/evidence/task-2-resolve-error.txt" Enter`
      3. poll file non-empty
    Expected: file contains `SKIP`.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task2e`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-2-resolve-error.txt
  **Commit**: Y | `feat(utils): add codegraph binary resolver (env/bundled/provisioned/path)` | Files: packages/utils/src/codegraph/resolve.ts, packages/utils/src/codegraph-resolve.test.ts

- [x] 3. CodeGraph workspace storage prepare — adoption rule: in-project-if-exists, else global+symlink (`packages/utils`)
  **What to do**: Create `packages/utils/src/codegraph/workspace.ts` porting pi's `workspaceStorageName`/`getCodeGraphDataRoot` (data root `~/.omo/codegraph`, store dir `~/.omo/codegraph/projects/<sanitizedBase>-<sha256(resolvedPath).slice(0,16)>/`) but with the USER-DECIDED **adoption rule** in `prepareCodegraphWorkspace(workspace)`:
    1. If `<workspace>/.codegraph` exists as a **real directory** (not a symlink) → **use in-place**, return `{ mode:"in-project", dataDir:<projectLink>, linked:false }` (do NOT move, do NOT symlink, do NOT touch its contents — this preserves the repo's existing ~5 GB index).
    2. Else if `.codegraph` exists as a **symlink** pointing to our store realpath → no-op, return `{ mode:"global-linked", linked:true }`. (Wrong-target symlink → treat as in-place fallback, return `{ mode:"in-place-fallback" }`, never throw.)
    3. Else (absent) → **same-filesystem check** between the repo and `~/.omo/codegraph`; if same FS, `mkdirSync` the store dir + create the symlink (junction on win32) → return `{ mode:"global-linked", linked:true }`. If cross-volume OR symlink/junction creation throws → create a real in-place `.codegraph/` dir → return `{ mode:"in-place-fallback", linked:false }`.
  Also export: `sanitizeBase` ([A-Za-z0-9._-], mirror git-bash `safePathSegment`); a `pruneCodegraphStore({maxBytes, maxAgeDays})` GC helper that removes least-recently-used `projects/*` entries over the cap (size/GC guard, C5); and `ensureCodegraphGitignored(workspace)` that adds `.codegraph` to `.git/info/exclude` (M2 — never to a committed `.gitignore`). NEVER throw out of `prepareCodegraphWorkspace`. Tests (TDD, tmp dirs): existing-real-dir→in-project+preserved; absent+same-fs→symlink; symlink-fail→in-place-fallback; wrong-target symlink→fallback; sanitizeBase; prune evicts LRU over cap; gitignore exclude written.
  **Must NOT do**: Never throw out of prepare (return a typed mode). Don't move/delete an existing real `.codegraph`. Don't write a committed `.gitignore` entry (use `.git/info/exclude`). Don't set any env var here. No cross-volume symlink.
  **Parallelization**: Wave 1 | Blocks: 8,9,14 | Blocked by: none
  **References**:
  - mengmotaHost `~/sionicai/pi-sionic/.../sionic-codegraph/index.ts:100-164` (`getCodeGraphDataRoot`, `workspaceStorageName`, `prepareCodeGraphWorkspace`) - the sha256-slice-16 store key + junction-on-win32 mechanics to port; WHY: parity. NOTE the adoption rule DIFFERS from pi (pi always symlinks + throws on conflict; we keep in-project if it exists and never throw).
  - draft `.omo/drafts/codegraph-session-bootstrap.md` (Metis C4/C5/C6) - WHY each guard exists: env vars cannot relocate the store (symlink only), 5 GB accretion needs GC, cross-volume junction fails, socket ~104-char limit favors in-place for deep paths.
  - `packages/omo-codex/plugin/components/git-bash/src/codex-hook.ts:134` (`safePathSegment`) - the sanitizer pattern to mirror for `<base>`.
  - `packages/utils/src/jsonc-parser.ts` - sibling module style/exports in this package.
  **Acceptance criteria**:
  - [ ] `bun test packages/utils` -> workspace.ts tests pass (adoption modes + sanitize + prune + gitignore).
  - [ ] tmp dir A (no `.codegraph`): `bun -e "const {prepareCodegraphWorkspace}=await import('<repo>/packages/utils/src/index.ts'); console.log(prepareCodegraphWorkspace(process.cwd()).mode)"` -> prints `global-linked`, and `readlink .codegraph` resolves under `~/.omo/codegraph/projects/`.
  - [ ] tmp dir B (pre-made real `.codegraph/keep`): same call -> prints `in-project`, and `.codegraph/keep` still exists.
  **QA scenarios**:
  - Scenario: fresh repo (no .codegraph) → global store + symlink
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task3 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task3 'set d (mktemp -d); cd $d; bun -e "const {prepareCodegraphWorkspace}=await import(\"/Users/yeongyu/local-workspaces/omo/packages/utils/src/index.ts\"); console.log(JSON.stringify(prepareCodegraphWorkspace(process.cwd())))"; readlink .codegraph; echo DONE $d | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace.txt; ls -la .codegraph >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace.txt' Enter`
      3. poll: `for i in (seq 1 60); grep -q DONE /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace.txt; and break; tmux capture-pane -t ulw-qa-task3 -pS -E - >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace.txt; end`
    Expected: JSON `"mode":"global-linked"` and `.codegraph` → a path under `~/.omo/codegraph/projects/<base>-<hash>`.
    Capture: the `tee`/append in step 2.
    Cleanup: `tmux kill-session -t ulw-qa-task3`; `rm -rf "$d"`; the global `projects/*` entry may remain (it IS the store) — note it; verify `tmux ls` has no `ulw-qa-task3`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-3-workspace.txt
  - Scenario: pre-existing real .codegraph dir → in-place, untouched (adoption + no data loss)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task3e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task3e 'set d (mktemp -d); cd $d; mkdir .codegraph; touch .codegraph/keep.txt; bun -e "const {prepareCodegraphWorkspace}=await import(\"/Users/yeongyu/local-workspaces/omo/packages/utils/src/index.ts\"); console.log(JSON.stringify(prepareCodegraphWorkspace(process.cwd())))" | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace-error.txt; test -f .codegraph/keep.txt && echo PRESERVED >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace-error.txt; test -L .codegraph && echo IS_SYMLINK >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-3-workspace-error.txt' Enter`
      3. poll for `PRESERVED` in the evidence file (loop shape above)
    Expected: JSON `"mode":"in-project"`; file contains `PRESERVED`; file does NOT contain `IS_SYMLINK` (existing real dir was not converted, contents intact, no crash).
    Capture: the `tee`/append in step 2.
    Cleanup: `tmux kill-session -t ulw-qa-task3e`; `rm -rf "$d"`; verify session gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-3-workspace-error.txt
  **Commit**: Y | `feat(utils): add codegraph workspace prepare (adopt in-project, else global+symlink)` | Files: packages/utils/src/codegraph/workspace.ts, packages/utils/src/codegraph-workspace.test.ts

- [x] 4. CodeGraph env builder + checksummed provisioning with per-host lock (`packages/utils`)
  **What to do**: Create `packages/utils/src/codegraph/env.ts` and `packages/utils/src/codegraph/provision.ts`.
  `env.ts`: `buildCodegraphEnv({homeDir})` returns the env to inject into every codegraph spawn — `CODEGRAPH_INSTALL_DIR=<home>/.omo/codegraph` (binary cache, NOT index store — see Metis C4), `CODEGRAPH_TELEMETRY` set to the package's OFF value + `DO_NOT_TRACK=1` (telemetry forced off — M6; confirm exact off-token from codegraph source `src/telemetry`), and daemon-lifecycle knobs left at codegraph defaults unless overridden (`CODEGRAPH_NO_DOWNLOAD=1` so a missing binary never silently network-downloads behind our backs — we control provisioning explicitly). Export the knob names as constants.
  `provision.ts`: `ensureCodegraphProvisioned({version:"1.0.1", lockDir})` mirroring the **ast-grep manifest+checksum** pattern (A2) — download the pinned `@colbymchenry/codegraph@1.0.1` platform bundle from the GitHub release, verify sha256 from a manifest, install under the provisioned prefix; guarded by a **per-host lockfile** (C8 — NOT the per-plugin-version bootstrap lock) + an idempotent completion marker so two concurrent sessions don't both download/corrupt the cache. Returns `{provisioned:boolean, binPath?, error?}`; on failure returns `{provisioned:false,error}` (never throws). Tests (TDD): env contains the off-token + install-dir; provision is idempotent (marker present ⇒ no-op); concurrent calls serialize on the lock (simulate); checksum mismatch ⇒ `{provisioned:false}` and no partial install left.
  **Must NOT do**: No `npm i -g` at runtime (supply-chain + self-installer trigger — A2). Never run `codegraph install` (self-installer mutates `~/.codex/config.toml`+AGENTS.md — Metis C3). Never throw. Don't set `CODEGRAPH_DIR` (rename-only, useless for relocation — C4).
  **Parallelization**: Wave 1 | Blocks: 8,9,13,14 | Blocked by: none
  **References**:
  - `packages/omo-codex/plugin/components/bootstrap/src/provision.ts` + `packages/omo-codex/plugin/components/bootstrap/manifests/ast-grep.json` (manifest is at `bootstrap/manifests/`, NOT under `src/`) - the manifest+sha256 checksummed-download + provisioned-prefix pattern to mirror; WHY: same supply-chain safety, avoids npm/self-installer.
  - `packages/omo-codex/plugin/components/bootstrap/src/hook.ts` (`resolveBootstrapLockPath`) - lock pattern; WHY: codegraph needs its OWN per-resource lock, not this per-version one (Metis C8).
  - codegraph source `src/telemetry*` + `src/directory.ts` (via `ssh mengmotaHost` or local `~/local-workspaces/codegraph`) - confirm the exact `CODEGRAPH_TELEMETRY` off value + that `CODEGRAPH_INSTALL_DIR` is the cache (NOT the index) — WHY: Metis C4/M6 the brief had this wrong.
  - draft `.omo/drafts/codegraph-session-bootstrap.md` (codegraph tool facts) - the env knob list (CODEGRAPH_NO_DOWNLOAD/NO_DAEMON/NO_WATCH/DAEMON_IDLE_TIMEOUT).
  **Acceptance criteria**:
  - [ ] `bun test packages/utils` -> env.ts + provision.ts tests pass (off-token, idempotent, lock, checksum-fail).
  - [ ] `bun -e "const {buildCodegraphEnv}=await import('./packages/utils/src/index.ts'); const e=buildCodegraphEnv({homeDir:process.env.HOME}); console.log(e.CODEGRAPH_INSTALL_DIR, e.DO_NOT_TRACK)"` -> prints `<home>/.omo/codegraph 1` and a telemetry-off var.
  **QA scenarios**:
  - Scenario: env injection forces telemetry off + scopes cache
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task4 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task4 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {buildCodegraphEnv}=await import(\"./packages/utils/src/index.ts\"); console.log(JSON.stringify(buildCodegraphEnv({homeDir:process.env.HOME})))" | tee .omo/evidence/task-4-env.txt' Enter`
      3. poll file non-empty
    Expected: JSON includes `CODEGRAPH_INSTALL_DIR` ending `/.omo/codegraph`, `DO_NOT_TRACK":"1"`, and the codegraph telemetry-off var.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task4`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-4-env.txt
  - Scenario: checksum mismatch → no install, graceful failure (no throw, no partial)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task4e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task4e 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {ensureCodegraphProvisioned}=await import(\"./packages/utils/src/index.ts\"); ensureCodegraphProvisioned({version:\"1.0.1\", forceBadChecksum:true, lockDir:(process.env.TMPDIR||\"/tmp\")}).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(\"THREW\"))" | tee .omo/evidence/task-4-provision-error.txt' Enter`
      3. poll file non-empty
    Expected: file shows `"provisioned":false` and NOT `THREW`; no partial bin left (the test asserts the prefix is clean).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task4e`; remove any temp prefix the test created; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-4-provision-error.txt
  **Commit**: Y | `feat(utils): add codegraph env (telemetry off) + checksummed provisioning with lock` | Files: packages/utils/src/codegraph/env.ts, packages/utils/src/codegraph/provision.ts, packages/utils/src/codegraph-env.test.ts, packages/utils/src/codegraph-provision.test.ts

- [x] 5. Root `THIRD-PARTY-NOTICES.md` — enumerated, not open-ended (repo root)
  **What to do**: First **enumerate the real redistributed set** (Metis C9 — do not trust the stale "13 deps" count): walk the published surface (`package.json` `files[]` + `dist/` bundle) and collect every third-party component actually shipped: the production npm deps with their license (read each `node_modules/<pkg>/LICENSE`), CodeGraph `@colbymchenry/codegraph@1.0.1` (MIT) **plus its 6 platform packages + the vendored Node runtime (Node's own + bundled OpenSSL/V8 notices) + tree-sitter WASM grammars** if omo provisions/bundles it, the `@ast-grep` binary (0.42.3) and `@ast-grep/cli`+`napi`, and the ported pi-* source (pi-lsp-client/pi-rules/pi-comment-checker, MIT, Yeongyu Kim). Write `/THIRD-PARTY-NOTICES.md` with one entry per component: name, version, license, copyright, upstream URL, where-bundled. Add a short generator note so it can be regenerated. Tests: a script `scripts/check-third-party-notices.mjs` (TDD: red first) that fails if a `dependencies`/bundled component is missing from the file.
  **Must NOT do**: Don't list dev-only deps not shipped. Don't open-endedly audit the whole tree — bound to the redistributed surface (Metis scope-creep watch). Don't claim a license without reading the actual LICENSE file. Don't include codegraph's claude/cursor/gemini installer targets (out of scope).
  **Parallelization**: Wave 1 | Blocks: 11 | Blocked by: none
  **References**:
  - `LICENSE.md` (root, SUL-1.0 + third-party clause) - WHY: SUL's "may not remove notices" makes this a compliance requirement, not a nicety (Metis C9).
  - `package.json` `files[]` (lines ~31-55) - the exact redistributed surface to enumerate against.
  - `packages/lsp-tools-mcp/NOTICE` + `packages/omo-codex/plugin/components/{lsp,rules,comment-checker}/NOTICE` - existing attribution format to match; WHY: consistency + these are the ported pi-* notices.
  - the vendoring-research result in draft `.omo/drafts/codegraph-session-bootstrap.md` (license lane) - the candidate component table to verify (not trust).
  **Acceptance criteria**:
  - [ ] `node scripts/check-third-party-notices.mjs` -> exit 0 (every shipped dep present).
  - [ ] `grep -c '^###' THIRD-PARTY-NOTICES.md` -> count >= number of shipped third-party components (sanity).
  - [ ] `grep -i 'codegraph\|ast-grep\|modelcontextprotocol' THIRD-PARTY-NOTICES.md` -> all present.
  **QA scenarios**:
  - Scenario: checker passes against the written notices
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task5 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task5 'cd /Users/yeongyu/local-workspaces/omo && node scripts/check-third-party-notices.mjs; echo "EXIT $status" | tee .omo/evidence/task-5-notices.txt' Enter`
      3. poll file non-empty
    Expected: file contains `EXIT 0`.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task5`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-5-green.txt
  - Scenario: checker FAILS when a shipped dep is removed from the notices (proves it actually guards)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task5e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task5e 'cd /Users/yeongyu/local-workspaces/omo && cp THIRD-PARTY-NOTICES.md /tmp/tpn.bak; node -e "const fs=require(\"fs\");fs.writeFileSync(\"THIRD-PARTY-NOTICES.md\", fs.readFileSync(\"THIRD-PARTY-NOTICES.md\",\"utf8\").replace(/### commander[\\s\\S]*?(?=\\n### |$)/,\"\"))"; node scripts/check-third-party-notices.mjs; echo "EXIT $status" | tee .omo/evidence/task-5-notices-error.txt; cp /tmp/tpn.bak THIRD-PARTY-NOTICES.md' Enter`
      3. poll file non-empty
    Expected: file contains a non-zero `EXIT` (checker detected the missing `commander` entry); the original file is restored afterward.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task5e`; confirm `git diff --stat THIRD-PARTY-NOTICES.md` is empty (restore held); `rm /tmp/tpn.bak`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-5-red.txt
  **Commit**: Y | `docs(license): add root THIRD-PARTY-NOTICES.md + checker` | Files: THIRD-PARTY-NOTICES.md, scripts/check-third-party-notices.mjs

- [x] 6. omo-codex `THIRD-PARTY-NOTICES.md` aggregate + audit/fix existing component NOTICEs (`packages/omo-codex`)
  **What to do**: Audit every `packages/omo-codex/plugin/components/*/` for a present+correct `NOTICE`+`LICENSE`; add any missing ones (components currently lacking them) following the existing format. Create `packages/omo-codex/THIRD-PARTY-NOTICES.md` aggregating: each component's ported-source attribution (pi-lsp-client→lsp, pi-rules→rules, pi-comment-checker→comment-checker), their npm deps (picomatch, @code-yeongyu/comment-checker, etc.), and — if codegraph ships inside the codex plugin bundle — the codegraph + platform-pkg + grammar notices. Extend `scripts/check-third-party-notices.mjs` (or a sibling) to also assert each omo-codex component with vendored/ported code has a NOTICE.
  **Must NOT do**: Don't duplicate the root file's full text — aggregate + point to component NOTICEs. Don't fabricate copyright years/owners — read the existing LICENSE files. Don't add NOTICEs to components with no third-party code.
  **Parallelization**: Wave 1 | Blocks: 11 | Blocked by: none
  **References**:
  - `packages/omo-codex/plugin/components/{lsp,rules,comment-checker,ulw-loop,ultrawork,start-work-continuation}/NOTICE` + `/LICENSE` - existing coverage to audit + the format to match.
  - root `package.json` `files[]` (lines 50-54 ship `packages/omo-codex/plugin` + `.codex-plugin`) + each component `package.json` `files[]` (e.g. `components/bootstrap/package.json:7`) + `script/sync-lazycodex-marketplace.ts` (copies the plugin into the marketplace) - the ACTUAL payload anchors that decide what ships; verify NOTICE files are included by THESE. NOTE: `.codex-plugin/plugin.json` is the plugin MANIFEST (skills/hooks/mcpServers paths), NOT the bundle/`files` list.
  - vendoring-research table in `.omo/drafts/codegraph-session-bootstrap.md` (license lane) - the per-component ported-from map (verify, don't trust).
  **Acceptance criteria**:
  - [ ] `node scripts/check-third-party-notices.mjs --codex` -> exit 0 (every ported/vendored component has a NOTICE).
  - [ ] `test -f packages/omo-codex/THIRD-PARTY-NOTICES.md && grep -ci 'pi-lsp-client\|pi-rules\|pi-comment-checker' packages/omo-codex/THIRD-PARTY-NOTICES.md` -> >= 3.
  **QA scenarios**:
  - Scenario: aggregate exists and covers ported components
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task6 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task6 'cd /Users/yeongyu/local-workspaces/omo && node scripts/check-third-party-notices.mjs --codex; echo EXIT $status | tee .omo/evidence/task-6-codex-notices.txt; grep -ci "pi-lsp-client\|pi-rules\|pi-comment-checker" packages/omo-codex/THIRD-PARTY-NOTICES.md >> .omo/evidence/task-6-codex-notices.txt' Enter`
      3. poll file non-empty
    Expected: `EXIT 0` and the grep count `>= 3`.
    Capture: the `tee`/append.
    Cleanup: `tmux kill-session -t ulw-qa-task6`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-6-green.txt
  - Scenario: a component missing its NOTICE is flagged
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task6e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task6e 'cd /Users/yeongyu/local-workspaces/omo && set c packages/omo-codex/plugin/components/rules/NOTICE; mv $c $c.bak; node scripts/check-third-party-notices.mjs --codex; echo EXIT $status | tee .omo/evidence/task-6-codex-notices-error.txt; mv $c.bak $c' Enter`
      3. poll file non-empty
    Expected: non-zero `EXIT` (missing rules NOTICE detected); NOTICE restored after.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task6e`; confirm `git status --porcelain packages/omo-codex/plugin/components/rules/NOTICE` empty (restore held); verify session gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-6-red.txt
  **Commit**: Y | `docs(license): add omo-codex THIRD-PARTY-NOTICES + backfill component NOTICEs` | Files: packages/omo-codex/THIRD-PARTY-NOTICES.md, packages/omo-codex/plugin/components/*/NOTICE (added), scripts/check-third-party-notices.mjs

- [x] 7. ~/.omo SOT loader + `[harness]` resolver + precedence (`packages/utils`)
  **What to do**: Create `packages/utils/src/omo-config/loader.ts` (+ `resolve.ts`) implementing the SOT read+merge using the todo-1 schema. `loadOmoConfig({harness, cwd, homeDir, env})` → reads `~/.omo/config.jsonc` (global) and walks ancestors of `cwd` for project `.omo/config.jsonc` (mirror opencode's nearest-first project walk), parses via `packages/utils/src/jsonc-parser.ts`, and produces the effective config by the DECIDED precedence (lowest→highest): built-in defaults < `~/.omo` base < `~/.omo` `[harness]` < project base < project `[harness]` < env overrides (back-compat, documented temporary). `[harness]` blocks are deep-merged over base; objects deep-merge, arrays dedupe (reuse opencode merge semantics). **Harness identity is PASSED explicitly** by the caller (`harness: "codex"|"opencode"|"omo"`) — never auto-sniffed (M4). Add `validateHarnessApplicability(config, harness)` returning warnings when a setting set under/for an unsupported harness (from todo-1 metadata) — for hinting. Return `{config, warnings, sources}`. Tests (TDD): base-only; base+`[codex]` deep-merge; project overrides global; env overrides project; unsupported-harness setting → warning; missing files → defaults (no throw).
  **Must NOT do**: No auto harness detection from argv/env. No opencode-specific mapping (A6 — keep generic). No write/seed here (that's todo 15). Don't make project `.omo/config.jsonc` rely on a committed `.gitignore` (M1: it's gitignored by `.omo/*` — document that project SOT lives at `.omo/config.jsonc` and is intentionally local unless force-added).
  **Parallelization**: Wave 2 | Blocks: 12 | Blocked by: 1
  **References**:
  - `packages/omo-opencode/src/plugin-config/layered-config-loader.ts:121` - the user-XDG-layers→project-ancestor-walk nearest-first precedence to mirror; WHY: the user said "follow ../opencode's per-project/per-location inheritance".
  - `packages/omo-opencode/src/plugin-config/config-merger.ts:16` - deepMerge + array-dedupe semantics to reuse.
  - `packages/omo-opencode/src/shared/project-discovery-dirs.ts:171` - ancestor `.opencode/*` discovery pattern → adapt to `.omo/config.jsonc`.
  - `packages/utils/src/jsonc-parser.ts` (`readJsoncFile`/`parseJsoncSafe`) - the parser to use.
  - todo 1 (`packages/utils/src/omo-config.ts`) - the schema + applicability metadata this consumes.
  **Acceptance criteria**:
  - [ ] `bun test packages/utils` -> loader/resolve tests pass (all precedence layers + harness merge + applicability warning + missing-file defaults).
  - [ ] `bun -e "const {loadOmoConfig}=await import('./packages/utils/src/index.ts'); console.log(JSON.stringify(loadOmoConfig({harness:'codex',cwd:process.cwd(),env:{}}).config))"` -> resolves without throw (defaults when no files).
  **QA scenarios**:
  - Scenario: [codex] block deep-merges over base
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task7 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task7 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"codegraph\":{\"enabled\":true},\"[codex]\":{\"codegraph\":{\"enabled\":false}}}" > $h/.omo/config.jsonc; cd /Users/yeongyu/local-workspaces/omo && bun -e "const {loadOmoConfig}=await import(\"./packages/utils/src/index.ts\"); const r=loadOmoConfig({harness:\"codex\",cwd:process.cwd(),homeDir:process.env.MOCKH,env:{}}); console.log(JSON.stringify(r.config.codegraph))" ; set -x MOCKH $h' Enter`
      3. (the loader must accept homeDir override; run) `tmux send-keys -t ulw-qa-task7 'env MOCKH=$h bun -e "const {loadOmoConfig}=await import(\"/Users/yeongyu/local-workspaces/omo/packages/utils/src/index.ts\"); const r=loadOmoConfig({harness:\"codex\",cwd:process.cwd(),homeDir:process.env.MOCKH,env:{}}); console.log(JSON.stringify(r.config.codegraph))" | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-7-sot-merge.txt' Enter`
      4. poll file non-empty
    Expected: `{"enabled":false}` (the `[codex]` block won over base `true`).
    Capture: the `tee` in step 3.
    Cleanup: `tmux kill-session -t ulw-qa-task7`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-7-sot-merge.txt
  - Scenario: setting under an unsupported harness emits a warning (hinting)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task7e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task7e 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"[opencode]\":{\"codegraph\":{\"someCodexOnlyKey\":1}}}" > $h/.omo/config.jsonc; env MOCKH=$h bun -e "const {loadOmoConfig}=await import(\"/Users/yeongyu/local-workspaces/omo/packages/utils/src/index.ts\"); const r=loadOmoConfig({harness:\"opencode\",cwd:process.cwd(),homeDir:process.env.MOCKH,env:{}}); console.log(r.warnings.length>0?\"WARNED\":\"NO_WARN\")" | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-7-sot-merge-error.txt' Enter`
      3. poll file non-empty
    Expected: `WARNED` (applicability validator flagged a harness-only/unknown key) — or `NO_WARN` only if the key is universally valid; the test fixture uses a deliberately codex-only key so expect `WARNED`.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task7e`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-7-sot-merge-error.txt
  **Commit**: Y | `feat(utils): add ~/.omo SOT loader with [harness] merge + precedence + applicability warnings` | Files: packages/utils/src/omo-config/loader.ts, packages/utils/src/omo-config/resolve.ts, packages/utils/src/omo-config-loader.test.ts

- [x] 8. opencode codegraph MCP config + register in `createBuiltinMcps` (`packages/omo-opencode`)
  **What to do**: Create `packages/omo-opencode/src/mcp/codegraph.ts` exporting `createCodegraphMcpConfig({cwd, resolveExecutable, config})` → a `LocalMcpConfig` `{type:"local", command:[<resolved codegraph>, "serve", "--mcp"], enabled: <binary resolvable per todo-2 resolver>, environment: buildCodegraphEnv()}`. The command resolves via the todo-2 resolver (inject opencode's `resolveRuntimeExecutable`/`Bun.which`); `enabled` is the **binary-exists** gate (USER DECISION — plugin handles init). Register in `createBuiltinMcps` (`src/mcp/index.ts`) behind `if(!disabledMcps.includes("codegraph") && config?.codegraph?.enabled !== false)`. Env from todo-4 `buildCodegraphEnv` (telemetry off). Tests (TDD): config has command+serve args; `enabled:false` when resolver says absent; honored by `disabled_mcps`; env carries telemetry-off.
  **Must NOT do**: Do NOT gate on index-exists (user chose binary-exists). Do NOT run `codegraph install`/`serve` here (registration only — the agent's MCP client launches serve). No import from omo-codex. Don't register when `config.codegraph.enabled===false`.
  **Parallelization**: Wave 3 | Blocks: F | Blocked by: 2,3,4,10
  **References**:
  - `packages/omo-opencode/src/mcp/lsp.ts:135-172` - the `LocalMcpConfig` shape + `enabled: resolvedCommand.exists` gate to copy exactly.
  - `packages/omo-opencode/src/mcp/index.ts:26-57` (`createBuiltinMcps`) - where + how to add the conditional entry (mirror lsp/ast_grep).
  - `packages/omo-opencode/src/mcp/runtime-executable.ts:32` - the injectable detector to pass into the todo-2 resolver.
  - `packages/omo-opencode/src/plugin-handlers/mcp-config-handler.ts:28-69` - the gate that deletes `disabled_mcps`; confirm "codegraph" flows through it.
  - todos 2 & 4 (`packages/utils` resolver + env) - the shared logic this wraps.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-opencode` -> codegraph mcp tests pass (enabled gate + env + disabled honored).
  - [ ] `bun -e "const {createBuiltinMcps}=await import('./packages/omo-opencode/src/mcp/index.ts'); const m=createBuiltinMcps([], {codegraph:{enabled:true}}, {cwd:process.cwd()}); console.log(!!m.codegraph, m.codegraph&&m.codegraph.command.join(' '))"` -> prints `true` and a command ending `serve --mcp` (enabled reflects whether codegraph is installed here).
  **QA scenarios**:
  - Scenario: codegraph MCP appears in opencode's built-in MCP set with serve args
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task8 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task8 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {createBuiltinMcps}=await import(\"./packages/omo-opencode/src/mcp/index.ts\"); const m=createBuiltinMcps([], {codegraph:{enabled:true}}, {cwd:process.cwd()}); console.log(JSON.stringify({present:!!m.codegraph, cmd:m.codegraph&&m.codegraph.command, enabled:m.codegraph&&m.codegraph.enabled, env:m.codegraph&&m.codegraph.environment}))" | tee .omo/evidence/task-8-opencode-mcp.txt' Enter`
      3. poll file non-empty
    Expected: JSON `present:true`, `cmd` ends with `["serve","--mcp"]`, `env` has telemetry-off var.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task8`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-8-manual/task-8-opencode-mcp.txt
  - Scenario: disabled_mcps removes it; binary-absent yields enabled:false
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task8e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task8e 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {createBuiltinMcps}=await import(\"./packages/omo-opencode/src/mcp/index.ts\"); const m=createBuiltinMcps([\"codegraph\"], {codegraph:{enabled:true}}, {cwd:process.cwd()}); console.log(m.codegraph?\"PRESENT\":\"ABSENT\")" | tee .omo/evidence/task-8-opencode-mcp-error.txt' Enter`
      3. poll file non-empty
    Expected: `ABSENT` (disabled_mcps honored).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task8e`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-8-manual/task-8-opencode-mcp-disabled.txt
  **Commit**: Y | `feat(opencode): register codegraph MCP in createBuiltinMcps (binary-gated)` | Files: packages/omo-opencode/src/mcp/codegraph.ts, packages/omo-opencode/src/mcp/index.ts, packages/omo-opencode/test/mcp/codegraph.test.ts

- [x] 9. opencode `session.created` codegraph bootstrap hook (`packages/omo-opencode`)
  **What to do**: Create `packages/omo-opencode/src/hooks/codegraph-bootstrap/` (hook.ts + index) firing on `session.created`: resolve project root (`input.directory`/`worktree`); if `config.codegraph.enabled !== false` AND binary resolvable-or-provisionable → run, in the BACKGROUND (non-blocking, never await on the session path): `prepareCodegraphWorkspace` (todo 3 adoption rule + `ensureCodegraphGitignored`) → `ensureCodegraphProvisioned` if needed (todo 4) → `codegraph status` → `codegraph init`/`sync` (todo via CLI, env from todo 4). All failures caught + logged via the hook's logger, NEVER thrown (never abort the session). Register it in `src/plugin/hooks/create-session-hooks.ts` + `src/plugin/event-hook-dispatcher.ts` with the `safeHook()` wrapper. Debounce to once-per-project-per-process. Tests (TDD): fires on session.created only; no-op when disabled; binary-absent path provisions-then-skips gracefully; never throws; runs detached/non-blocking (the hook returns before init completes).
  **Must NOT do**: Never block session start (background only). Never throw out of the hook. Don't run `codegraph serve` (the MCP client does). Don't re-run per message (session.created only, debounced). No import from omo-codex.
  **Parallelization**: Wave 3 | Blocks: F | Blocked by: 2,3,4,10
  **References**:
  - `packages/omo-opencode/src/hooks/auto-update-checker/hook.ts` - the factory + event-handler hook pattern + how it does background work without blocking; copy this shape.
  - `packages/omo-opencode/src/plugin/event.ts:141-151` - the `session.created` branch to hook into.
  - `packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts:66` + `src/plugin/event-hook-dispatcher.ts:37` - where to register with `safeHook()`.
  - mengmotaHost `~/sionicai/pi-sionic/.../sionic-codegraph/index.ts:432-496` (`runStartupSync`) - the prepare→provision→status→init|sync sequence + never-abort semantics to port (adapted: no TUI widget; log instead).
  - todos 3 & 4 - prepare + provision/env helpers.
  - `AGENTS.md` §OPENCODE rules 1-2 + `.agents/skills/opencode-qa/` - MANDATORY: any QA that spawns opencode MUST run inside an isolated XDG sandbox and PROVE isolation via before/after `opencode.db` session counts; use this skill's harness, never pollute the real `~/.local/share/opencode/opencode.db`.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-opencode` -> hook tests pass (fires-once, disabled no-op, never-throws, non-blocking).
  - [ ] `rg -n "codegraph-bootstrap" packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts packages/omo-opencode/src/plugin/event-hook-dispatcher.ts` -> registered in both.
  **QA scenarios**:
  - Scenario: real opencode session start triggers codegraph bootstrap, session stays responsive (XDG-ISOLATED + session-count proof, per AGENTS.md opencode-qa)
    Tool: tmux
    Steps:
      1. `bun run build` (build the plugin).
      2. `tmux new-session -d -s ulw-qa-task9 -x 200 -y 50 fish`
      3. `tmux send-keys -t ulw-qa-task9 'cd /Users/yeongyu/local-workspaces/omo && for v in XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; set -x $v (mktemp -d); end; mkdir -p $XDG_CONFIG_HOME/opencode; printf "{\"plugin\":[\"%s/packages/omo-opencode/dist/index.js\"]}" $PWD > $XDG_CONFIG_HOME/opencode/opencode.jsonc; set -x REAL_DB ~/.local/share/opencode/opencode.db; set -x REAL_BEFORE (sqlite3 $REAL_DB "select count(*) from session" 2>/dev/null; or echo 0)' Enter`
      4. `tmux send-keys -t ulw-qa-task9 'OMO_LOG=debug opencode run --format json "say hi" 2>&1 | tee .omo/evidence/task-9-opencode-session.txt; echo "ISO_SESSIONS="(sqlite3 $XDG_DATA_HOME/opencode/opencode.db "select count(*) from session" 2>/dev/null; or echo 0)" REAL_BEFORE=$REAL_BEFORE REAL_AFTER="(sqlite3 $REAL_DB "select count(*) from session" 2>/dev/null; or echo 0) >> .omo/evidence/task-9-opencode-session.txt' Enter`
      5. poll: `for i in (seq 1 90); grep -q "ISO_SESSIONS=" .omo/evidence/task-9-opencode-session.txt; and break; tmux capture-pane -t ulw-qa-task9 -pS -E - >> .omo/evidence/task-9-opencode-session.txt; end`
    Expected: the run completes (model replies "hi"); the log shows the codegraph bootstrap fired (a `codegraph status`/`init`/`sync` line); `ISO_SESSIONS` >= 1 (the isolated db got the session) AND `REAL_AFTER == REAL_BEFORE` (the real `~/.local/share/opencode/opencode.db` was NOT polluted — isolation proven).
    Capture: the two `tee`/`>>` appends + capture-pane.
    Cleanup: `tmux send-keys -t ulw-qa-task9 'rm -rf $XDG_DATA_HOME $XDG_CONFIG_HOME $XDG_STATE_HOME $XDG_CACHE_HOME' Enter`; `tmux kill-session -t ulw-qa-task9`; verify `tmux ls` clean.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-9-codegraph-bootstrap/opencode-normal.txt
  - Scenario: binary missing → bootstrap logs + skips, session still succeeds (XDG-isolated)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task9e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task9e 'cd /Users/yeongyu/local-workspaces/omo && for v in XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; set -x $v (mktemp -d); end; mkdir -p $XDG_CONFIG_HOME/opencode; printf "{\"plugin\":[\"%s/packages/omo-opencode/dist/index.js\"]}" $PWD > $XDG_CONFIG_HOME/opencode/opencode.jsonc; set -x d (mktemp -d); cd $d; git init -q; env OMO_CODEGRAPH_BIN=/nonexistent OMO_LOG=debug opencode run --format json "say hi" 2>&1 | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-9-opencode-session-error.txt' Enter`
      3. poll for the model reply or a codegraph skip log (loop shape above)
    Expected: run still completes (model replies) and the log shows a graceful codegraph skip/provision-failure line — NO crash/abort.
    Capture: the `tee`.
    Cleanup: `tmux send-keys -t ulw-qa-task9e 'rm -rf $XDG_DATA_HOME $XDG_CONFIG_HOME $XDG_STATE_HOME $XDG_CACHE_HOME $d' Enter`; `tmux kill-session -t ulw-qa-task9e`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-9-codegraph-bootstrap/opencode-missing-bin.txt
  **Commit**: Y | `feat(opencode): codegraph bootstrap hook on session.created (background, non-fatal)` | Files: packages/omo-opencode/src/hooks/codegraph-bootstrap/*, packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts, packages/omo-opencode/src/plugin/event-hook-dispatcher.ts, packages/omo-opencode/test/hooks/codegraph-bootstrap.test.ts

- [x] 10. opencode codegraph config schema section (`packages/omo-opencode`)
  **What to do**: Create `packages/omo-opencode/src/config/schema/codegraph.ts` — a Zod section: `enabled` (boolean, **default true = "local machine mode always on"** per user; opt-out via `false`), `install_dir?` (string), `watch_debounce_ms?` (number), `auto_provision?` (boolean, default true). Add `codegraph: CodegraphConfigSchema.optional()` to `OhMyOpenCodeConfigSchema` (`src/config/schema/oh-my-opencode-config.ts`) and export the type from `src/config/index.ts`. Keep the field shape identical to the shared `packages/utils` `OmoConfig.codegraph` (todo 1) so opencode can later read the SOT without a remap (A6). This is opencode's CURRENT config source for codegraph (opencode keeps `oh-my-openagent.json`; NO SOT read this plan). Tests (TDD): schema parses `{codegraph:{enabled:false}}`; default enabled=true when omitted; rejects bad types.
  **Must NOT do**: Do NOT wire opencode to read `~/.omo` SOT (out of scope — opencode migration is later). No new validator dep. Keep keys in lockstep with `packages/utils` OmoConfig.codegraph.
  **Parallelization**: Wave 2 | Blocks: 8,9,F | Blocked by: 1
  **References**:
  - `packages/omo-opencode/src/config/schema/team-mode.ts:1-18` - the canonical small section (defaults, optional) to mirror.
  - `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts:31` - where to compose the section in.
  - `packages/omo-opencode/src/config/index.ts` - type export location.
  - todo 1 (`packages/utils/src/omo-config.ts`) - keep `codegraph` keys identical (default-true enabled, install_dir, watch_debounce_ms, auto_provision).
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-opencode` -> config schema tests pass (default-true, opt-out, bad-type rejected).
  - [ ] `bun -e "const {OhMyOpenCodeConfigSchema}=await import('./packages/omo-opencode/src/config/index.ts'); const c=OhMyOpenCodeConfigSchema.parse({}); console.log(c.codegraph?.enabled)"` -> prints `true` or `undefined` (default applied at read; assert the read path yields enabled-by-default).
  **QA scenarios**:
  - Scenario: opt-out via config disables registration end-to-end
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task10 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task10 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {createBuiltinMcps}=await import(\"./packages/omo-opencode/src/mcp/index.ts\"); console.log(createBuiltinMcps([], {codegraph:{enabled:false}}, {cwd:process.cwd()}).codegraph?\"PRESENT\":\"ABSENT\")" | tee .omo/evidence/task-10-config.txt' Enter`
      3. poll file non-empty
    Expected: `ABSENT` (enabled:false skips registration — confirms schema wires to todo 8's gate).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task10`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-10-schema-cli.txt
  - Scenario: malformed codegraph config is rejected with a clear error
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task10e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task10e 'cd /Users/yeongyu/local-workspaces/omo && bun -e "const {OhMyOpenCodeConfigSchema}=await import(\"./packages/omo-opencode/src/config/index.ts\"); try{OhMyOpenCodeConfigSchema.parse({codegraph:{enabled:\"yes\"}});console.log(\"NO_THROW\")}catch(e){console.log(\"REJECTED\")}" | tee .omo/evidence/task-10-config-error.txt' Enter`
      3. poll file non-empty
    Expected: `REJECTED`.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task10e`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-10-schema-cli-defaults.txt
  **Commit**: Y | `feat(opencode): add codegraph config section (enabled default true)` | Files: packages/omo-opencode/src/config/schema/codegraph.ts, packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts, packages/omo-opencode/src/config/index.ts, packages/omo-opencode/test/config/codegraph-schema.test.ts

- [x] 11. License ship-verification — NOTICES land in published tarballs (repo root + omo-codex)
  **What to do**: Ensure `THIRD-PARTY-NOTICES.md` (root) and `packages/omo-codex/THIRD-PARTY-NOTICES.md` are in the respective `package.json` `files[]` arrays and that the omo-codex plugin build copies component `NOTICE`/`LICENSE` files + the aggregate into the published plugin payload. Extend `scripts/check-third-party-notices.mjs` with a `--ship` mode that runs `npm pack --dry-run --json --ignore-scripts` (root) through a parser tolerant of npm lifecycle noise, then inspects the codex plugin bundle to assert every NOTICE/THIRD-PARTY file is present in the tarball file list. Wire `--ship` into the existing test/CI gate.
  **Must NOT do**: Don't actually publish. Don't add files to `files[]` that aren't notices. Don't break the existing build.
  **Parallelization**: Wave 2 | Blocks: F | Blocked by: 5,6
  **References**:
  - `package.json` `files[]` (~31-55) - add root `THIRD-PARTY-NOTICES.md` here.
  - root `package.json` `files[]` (already ships `packages/omo-codex/plugin`, lines 50-54) + `packages/omo-codex/plugin/package.json` (build) + each component `package.json` `files[]` (e.g. `components/bootstrap/package.json:7`) + `script/sync-lazycodex-marketplace.ts` - the ACTUAL payload anchors where the shipped file list is decided; ensure NOTICEs are covered by these. `.codex-plugin/plugin.json` is the manifest, NOT the bundle list — do not treat it as the `files` source.
  - memory `lazycodex-publish-payload-node-fallback` (plugin cache feeds from oh-my-openagent tarball) - WHY: the codex plugin ships via the oh-my-openagent tarball, so root-tarball inclusion matters for codex too.
  - todos 5 & 6 - the files this verifies.
  **Acceptance criteria**:
  - [ ] `node scripts/check-third-party-notices.mjs --ship` -> exit 0 (root + codex notices present in packed file lists).
  - [ ] `npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(let i=s.indexOf('[');i!==-1;i=s.indexOf('[',i+1)){try{const p=JSON.parse(s.slice(i));const f=p[0].files.map(x=>x.path);process.exit(f.some(x=>/THIRD-PARTY-NOTICES/.test(x))?0:1)}catch(e){if(!(e instanceof SyntaxError))throw e}}process.exit(1)})"` -> exit 0.
  **QA scenarios**:
  - Scenario: packed root tarball contains the notices
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task11 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task11 'cd /Users/yeongyu/local-workspaces/omo && npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{for(let i=s.indexOf(\"[\");i!==-1;i=s.indexOf(\"[\",i+1)){try{const p=JSON.parse(s.slice(i));const f=p[0].files.map(x=>x.path); console.log(f.filter(x=>/THIRD-PARTY|NOTICE/.test(x)).join(\"\\n\")||\"NONE\"); process.exit(0)}catch(e){if(!(e instanceof SyntaxError))throw e}}process.exit(1)})" | tee .omo/evidence/task-11-ship.txt' Enter`
      3. poll file non-empty
    Expected: file lists `THIRD-PARTY-NOTICES.md` (not `NONE`).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task11`; remove any `*.tgz` npm pack left (`rm -f *.tgz`); verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-11-green.txt
  - Scenario: --ship FAILS if a notice is excluded from files[] (guard proven)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task11e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task11e 'cd /Users/yeongyu/local-workspaces/omo && cp package.json /tmp/pkg.bak; node -e "const fs=require(\"fs\");const p=JSON.parse(fs.readFileSync(\"package.json\"));p.files=p.files.filter(x=>!/THIRD-PARTY/.test(x));fs.writeFileSync(\"package.json\",JSON.stringify(p,null,2))"; node scripts/check-third-party-notices.mjs --ship; echo EXIT $status | tee .omo/evidence/task-11-ship-error.txt; cp /tmp/pkg.bak package.json' Enter`
      3. poll file non-empty
    Expected: non-zero `EXIT` (ship check caught the excluded notice); package.json restored.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task11e`; confirm `git diff --stat package.json` empty (restore held); `rm -f /tmp/pkg.bak *.tgz`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-11-red.txt
  **Commit**: Y | `build(license): ship THIRD-PARTY-NOTICES in root + codex tarballs + ship check` | Files: package.json (root files[]), packages/omo-codex/plugin/package.json, packages/omo-codex/plugin/components/*/package.json (files[] as needed), script/sync-lazycodex-marketplace.ts, scripts/check-third-party-notices.mjs

- [x] 12. codex shared `~/.omo` SOT loader module (`packages/omo-codex/plugin/shared`)
  **What to do**: Create `packages/omo-codex/plugin/shared/src/config-loader.ts` — the codex-side entry that calls `packages/utils` `loadOmoConfig({harness:"codex", cwd, homeDir, env})` (todo 7) and exposes a typed `getCodexOmoConfig()` each component CLI imports. **Scaffold the new `packages/omo-codex/plugin/shared/` package** with `package.json` + `tsconfig.json` + `tsconfig.build.json` (mirror `packages/omo-codex/plugin/components/git-bash/` layout), and register `packages/omo-codex/plugin/shared/tsconfig.json` in the root `package.json` `typecheck:packages` chain. Components import the loader via relative path (`../../shared/src/config-loader.ts`); `build-components.mjs` inlines it into each component's bundle, so `shared` needs no standalone dist. Preserve env-var back-compat: existing `CODEX_*`/`PI_*` env still override the SOT value (precedence already in todo 7). Tests (TDD): `getCodexOmoConfig` returns `[codex]`-merged config; env override wins; missing `~/.omo/config.jsonc` → defaults; harness is always "codex".
  **Must NOT do**: Do NOT auto-detect harness (hardcode "codex" here — M4). No cross-import from omo-opencode. Don't read `~/.codex/config.toml` for omo config (SOT is `~/.omo/config.jsonc`). Don't break existing env-var consumers.
  **Parallelization**: Wave 3 | Blocks: 13,14,15 | Blocked by: 7
  **References**:
  - `packages/omo-codex/plugin/components/rules/src/config.ts:5-42` - the current env-only loader shape + `CODEX_*`/`PI_*` fallback chain to preserve as overrides.
  - `packages/omo-codex/plugin/components/rules/src/cli.ts:38-40` - how a component cli invokes its config loader (the import pattern to mirror).
  - `packages/utils/src/omo-config/loader.ts` (todo 7) - the function this wraps with `harness:"codex"`.
  - research note in `.omo/drafts/codegraph-session-bootstrap.md` (codex SOT lane) - `plugin/shared/src/config-loader.ts` is the agreed home; components build independently to `dist/cli.js`.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-codex` (or the codex test cmd) -> shared loader tests pass.
  - [ ] `bun -e "const {getCodexOmoConfig}=await import('./packages/omo-codex/plugin/shared/src/config-loader.ts'); console.log(JSON.stringify(getCodexOmoConfig({cwd:process.cwd(),env:{}}).codegraph||{}))"` -> resolves without throw.
  **QA scenarios**:
  - Scenario: codex loader applies [codex] block + env override precedence
    Tool: tmux
    Steps:
      1. `npm --prefix packages/omo-codex/plugin run build` (build shared + components)
      2. `tmux new-session -d -s ulw-qa-task12 -x 200 -y 50 fish`
      3. `tmux send-keys -t ulw-qa-task12 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"codegraph\":{\"enabled\":true},\"[codex]\":{\"codegraph\":{\"enabled\":false}}}" > $h/.omo/config.jsonc; cd /Users/yeongyu/local-workspaces/omo && env MOCKH=$h bun -e "const {getCodexOmoConfig}=await import(\"./packages/omo-codex/plugin/shared/src/config-loader.ts\"); console.log(JSON.stringify(getCodexOmoConfig({cwd:process.cwd(),homeDir:process.env.MOCKH,env:{}}).codegraph))" | tee .omo/evidence/task-12-codex-sot.txt' Enter`
      4. poll file non-empty
    Expected: `{"enabled":false}` ([codex] block won).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task12`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-12-codex-shared-sot-loader/manual-codex-block.txt
  - Scenario: legacy env var still overrides SOT (back-compat)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task12e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task12e 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"codegraph\":{\"enabled\":true}}" > $h/.omo/config.jsonc; cd /Users/yeongyu/local-workspaces/omo && env MOCKH=$h CODEX_CODEGRAPH_ENABLED=0 bun -e "const {getCodexOmoConfig}=await import(\"./packages/omo-codex/plugin/shared/src/config-loader.ts\"); console.log(getCodexOmoConfig({cwd:process.cwd(),homeDir:process.env.MOCKH,env:process.env}).codegraph.enabled)" | tee .omo/evidence/task-12-codex-sot-error.txt' Enter`
      3. poll file non-empty
    Expected: `false` (env override beat SOT `true`).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task12e`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-12-codex-shared-sot-loader/manual-env-override.txt
  **Commit**: Y | `feat(codex): add ~/.omo SOT loader (harness=codex) shared module` | Files: packages/omo-codex/plugin/shared/{package.json,tsconfig.json,tsconfig.build.json}, packages/omo-codex/plugin/shared/src/config-loader.ts, packages/omo-codex/plugin/shared/test/config-loader.test.ts, package.json (typecheck:packages)

- [x] 13. codex codegraph MCP entry (`required=false`) + serve-wrapper (`packages/omo-codex`)
  **What to do**: First **scaffold + register the new component** (so the build pipeline knows about it before any QA runs `npm run build`): create `packages/omo-codex/plugin/components/codegraph/` with `package.json` + `tsconfig.json` + `tsconfig.build.json` (mirror `packages/omo-codex/plugin/components/git-bash/`), and add `"components/codegraph"` to the `workspaces[]` array in `packages/omo-codex/plugin/package.json` so `scripts/build-components.mjs` compiles its `src/*.ts` → `dist/*.js` (this todo's `src/serve.ts`→`dist/serve.js`; todo 14's `src/cli.ts`→`dist/cli.js`). Then add a `codegraph` server to `packages/omo-codex/plugin/.mcp.json` with `required = false` (graceful-skip — VERIFIED codex behavior) pointing at a new **serve-wrapper** `packages/omo-codex/plugin/components/codegraph/src/serve.ts` → `dist/serve.js`, invoked as `node .../codegraph/dist/serve.js`. The wrapper: resolve the codegraph binary (todo 2 resolver, codex node runtime) + build env (todo 4, telemetry off); if resolvable → `exec`/spawn `codegraph serve --mcp` (replace process); if NOT resolvable → print a one-line stderr hint and `process.exit(1)` immediately (codex logs `McpStartupUpdateEvent` failure + skips, session unaffected — the git_bash-unified style). Also ensure the install-time `config.mjs` enables the `codegraph` plugin MCP (`ensurePluginMcpEnabled`) so the entry is active. Tests (TDD): wrapper exits 1 fast when binary unresolvable (no hang); wrapper execs serve when resolvable (mock); `.mcp.json` has `required:false`.
  **Must NOT do**: Do NOT mark `required:true` (would make a missing binary fatal). Do NOT run `codegraph install`/`status`/`init` in the wrapper (serve only — init is the SessionStart component's job, todo 14). Don't let the wrapper hang when the binary is missing (fast exit). Don't write `~/.codex/config.toml`/`AGENTS.md` from codegraph self-installer (Metis C3 guardrail).
  **Parallelization**: Wave 4 | Blocks: 14,F | Blocked by: 2,4,12
  **References**:
  - `packages/omo-codex/plugin/.mcp.json` - the static MCP manifest to add `codegraph` to (mirror `lsp`/`git_bash` entry shape; add `required:false`).
  - `packages/omo-codex/scripts/install/config.mjs` (`ensurePluginMcpEnabled`) - the install-time enable mechanism; WHY: codex enablement is install-time (Metis C1), so the entry must be enabled here.
  - `codex-rs/codex-mcp/src/connection_manager.rs:140-144,287-327` + `config/src/mcp_types.rs:141-143` - PROOF that `required:false` ⇒ graceful skip on spawn failure (the whole design rests on this).
  - mengmotaHost `~/sionicai/pi-sionic/.../sionic-codegraph/index.ts:203-217` (`resolveCodeGraphCommand`) - resolution the wrapper performs before exec.
  - `packages/git-bash-mcp/src/git-bash-resolver.ts:73-82` (`missingGitBash` installHint) - the one-line hint style to print on stderr before exit 1.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-codex` -> serve-wrapper tests pass (fast-exit-1 when unresolvable; exec when resolvable).
  - [ ] `node -e "const j=require('./packages/omo-codex/plugin/.mcp.json'); console.log(j.mcpServers.codegraph.required===false)"` -> `true`.
  - [ ] `OMO_CODEGRAPH_BIN=/nonexistent timeout 5 node packages/omo-codex/plugin/components/codegraph/dist/serve.js; echo $status` -> non-zero within 5s (no hang).
  **QA scenarios**:
  - Scenario: codex real run with codegraph present → MCP serves, tools usable (ISOLATED CODEX_HOME)
    Tool: tmux
    Steps:
      1. `npm --prefix packages/omo-codex/plugin run build` (build shared + codegraph component).
      2. Preflight-provision so the binary is present (concrete, not "ensure"): `bun -e "const {ensureCodegraphProvisioned}=await import('./packages/utils/src/index.ts'); const r=await ensureCodegraphProvisioned({version:'1.0.1'}); console.log(r.provisioned?('READY '+r.binPath):'UNAVAILABLE'); process.exit(r.provisioned?0:2)" | tee .omo/evidence/task-13-preflight.txt`. If it prints `UNAVAILABLE` (exit 2), SKIP this happy-path scenario (the binary-absent scenario below covers that case) and record the skip in evidence.
      3. `tmux new-session -d -s ulw-qa-task13 -x 200 -y 50 fish`
      4. `tmux send-keys -t ulw-qa-task13 'set -x CODEX_HOME (mktemp -d); cd /Users/yeongyu/local-workspaces/omo && node packages/omo-codex/scripts/install-local.mjs 2>&1 | tail -3' Enter` (install the omo codex plugin into the throwaway CODEX_HOME so the user's real `~/.codex` is never touched — Metis C3)
      5. `tmux send-keys -t ulw-qa-task13 'codex exec --sandbox read-only -c model_reasoning_effort=low "list available mcp tools, then stop" 2>&1 | tee .omo/evidence/task-13-codex-mcp.txt' Enter`
      6. poll: `for i in (seq 1 90); grep -qi "codegraph\|mcp" .omo/evidence/task-13-codex-mcp.txt; and break; tmux capture-pane -t ulw-qa-task13 -pS -E - >> .omo/evidence/task-13-codex-mcp.txt; end`
    Expected: `codegraph` MCP appears among the listed tools (or a startup-ready line for it); no session error; the run completes.
    Capture: the `tee` + capture-pane appends.
    Cleanup: `tmux send-keys -t ulw-qa-task13 'rm -rf $CODEX_HOME' Enter`; `tmux kill-session -t ulw-qa-task13`; verify the user's real `~/.codex/config.toml` is unmodified (`git -C ~/.codex diff` if tracked, else it was never the target) and `tmux ls` has no `ulw-qa-task13`.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-13-manual/isolated-codex-qa-corrected.txt
  - Scenario: binary absent → wrapper exits 1 fast, codex session unaffected (required=false graceful skip)
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task13e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task13e 'cd /Users/yeongyu/local-workspaces/omo && set t0 (date +%s); env OMO_CODEGRAPH_BIN=/nonexistent timeout 5 node packages/omo-codex/plugin/components/codegraph/dist/serve.js; echo "EXIT $status after "(math (date +%s) - $t0)"s" | tee .omo/evidence/task-13-codex-mcp-error.txt' Enter`
      3. poll file non-empty
    Expected: `EXIT` non-zero `after` < 5s (fast fail, no hang) + a stderr hint line captured.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task13e`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-13-red/accept-fast-fail.txt
  **Commit**: Y | `feat(codex): declare codegraph MCP (required=false) with resolve-or-skip serve-wrapper` | Files: packages/omo-codex/plugin/components/codegraph/{package.json,tsconfig.json,tsconfig.build.json}, packages/omo-codex/plugin/package.json (workspaces[]), packages/omo-codex/plugin/.mcp.json, packages/omo-codex/plugin/components/codegraph/src/serve.ts, packages/omo-codex/scripts/install/config.mjs, packages/omo-codex/plugin/components/codegraph/test/serve.test.ts

- [x] 14. codex codegraph SessionStart component (`packages/omo-codex/plugin/components/codegraph`)
  **What to do**: The component dir `packages/omo-codex/plugin/components/codegraph/` plus its `package.json`/tsconfigs and `workspaces[]` registration ALREADY EXIST from todo 13 — this todo only ADDS `src/cli.ts` + `src/hook.ts` to it and wires `hooks.json`. Build the codegraph component CLI `src/cli.ts` → `dist/cli.js` with a `hook session-start` handler (mirror `bootstrap`/`rules` components). On session start: read `getCodexOmoConfig` (todo 12); if `codegraph.enabled !== false` AND binary resolvable-or-provisionable → BACKGROUND (detached, non-blocking; emit the codex hook JSON outcome immediately): `prepareCodegraphWorkspace` (todo 3, +gitignore exclude) → `ensureCodegraphProvisioned` if needed (todo 4) → `codegraph status` → `init`/`sync` (env from todo 4). Failures captured into the JSON outcome, never fatal. Wire the component into `plugin/hooks/hooks.json` `SessionStart` (after bootstrap). Tests (TDD): handler emits valid JSON outcome; disabled → no-op JSON; binary-absent → provision-then-skip graceful JSON; never throws; init runs detached (handler returns before completion).
  **Must NOT do**: Never block the hook (detached background). Never `codegraph install`/`serve` (status/init/sync only — Metis C3). Never throw (emit JSON). Don't mutate `~/.codex/config.toml`/`AGENTS.md`. Verify the hook does NOT cause codegraph self-installer to touch codex config (add the assertion in QA).
  **Parallelization**: Wave 5 | Blocks: 15 | Blocked by: 3,4,12,13
  **References**:
  - `packages/omo-codex/plugin/components/bootstrap/src/hook.ts:40-77` (`runSessionStartHook`) - the detached-worker SessionStart pattern + JSON-to-stdout shape to copy.
  - `packages/omo-codex/plugin/components/comment-checker/src/codex-hook.ts` - the component cli hook I/O contract (input parse, JSON out).
  - `packages/omo-codex/plugin/hooks/hooks.json` - the SessionStart array to register the component into (mirror the bootstrap/rules entries).
  - mengmotaHost `~/sionicai/pi-sionic/.../sionic-codegraph/index.ts:432-496` (`runStartupSync`) - the prepare→provision→status→init|sync sequence + never-abort.
  - todos 3,4,12 - prepare/provision/env + the codex SOT config.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-codex` -> codegraph component tests pass.
  - [ ] `node packages/omo-codex/plugin/components/codegraph/dist/cli.js hook session-start <<<'{}'; echo $status` -> emits JSON, exit 0.
  - [ ] `rg -n "components/codegraph/dist/cli.js" packages/omo-codex/plugin/hooks/hooks.json` -> present under SessionStart.
  **QA scenarios**:
  - Scenario: SessionStart hook prepares index + reports JSON, codex config untouched
    Tool: tmux
    Steps:
      1. `npm --prefix packages/omo-codex/plugin run build`
      2. `tmux new-session -d -s ulw-qa-task14 -x 200 -y 50 fish`
      3. `tmux send-keys -t ulw-qa-task14 'set -x CODEX_HOME (mktemp -d); set d (mktemp -d); cd $d; git init -q; echo "{}" | env CODEX_HOME=$CODEX_HOME node /Users/yeongyu/local-workspaces/omo/packages/omo-codex/plugin/components/codegraph/dist/cli.js hook session-start | tee /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-14-codex-component.txt; sleep 2; ls -la .codegraph >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-14-codex-component.txt; test ! -e $CODEX_HOME/config.toml; and test ! -e $CODEX_HOME/AGENTS.md; and echo "CODEX_HOME_CLEAN" >> /Users/yeongyu/local-workspaces/omo/.omo/evidence/task-14-codex-component.txt' Enter` (ISOLATED `CODEX_HOME`; assert the hook never writes codex config there — the real `~/.codex` is never read or touched)
      4. poll for `CODEX_HOME_CLEAN` (loop shape above)
    Expected: valid JSON outcome printed; `.codegraph` prepared (symlink or in-place); `CODEX_HOME_CLEAN` present (the hook ran only status/init/sync and never triggered codegraph's self-installer — Metis C3).
    Capture: the `tee`/appends.
    Cleanup: `tmux kill-session -t ulw-qa-task14`; `rm -rf "$d" "$CODEX_HOME"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-14-codegraph-sessionstart/qa-sessionstart-enabled.txt
  - Scenario: disabled via SOT → component no-ops cleanly
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task14e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task14e 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"[codex]\":{\"codegraph\":{\"enabled\":false}}}" > $h/.omo/config.jsonc; cd /Users/yeongyu/local-workspaces/omo && echo "{}" | env MOCKH=$h HOME=$h node packages/omo-codex/plugin/components/codegraph/dist/cli.js hook session-start | tee .omo/evidence/task-14-codex-component-error.txt' Enter`
      3. poll file non-empty
    Expected: JSON outcome indicating disabled/skipped (no prepare, no provision), exit 0.
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task14e`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-14-codegraph-sessionstart/qa-sessionstart-disabled.txt
  **Commit**: Y | `feat(codex): add codegraph SessionStart component (background init/sync, non-fatal)` | Files: packages/omo-codex/plugin/components/codegraph/src/cli.ts, packages/omo-codex/plugin/components/codegraph/src/hook.ts, packages/omo-codex/plugin/hooks/hooks.json, packages/omo-codex/plugin/components/codegraph/test/hook.test.ts

- [x] 15. codex install/seed `~/.omo` SOT + migration scaffolding (`packages/omo-codex/scripts`)
  **What to do**: On install/auto-update, seed `~/.omo/config.jsonc` if absent (a commented JSONC scaffold showing base + `[codex]`/`[opencode]` blocks + the codegraph keys) and register the codegraph component build outputs. Add a migration step in `plugin/scripts/migrate-codex-config.mjs` (or a new `migrate-omo-sot.mjs` called by `auto-update.mjs`) that: reads any legacy `CODEX_*` env / `~/.codex/config.toml` codegraph-ish settings and writes their equivalents into `~/.omo/config.jsonc` `[codex]` (idempotent, comment-preserving via jsonc-parser), WITHOUT removing the env fallback (back-compat). Ensure the codegraph component is built + bundled (its `dist/cli.js` + `dist/serve.js`) by the codex build/sync pipeline. Tests (TDD): seed creates a valid parseable scaffold; idempotent (second run no-op / no dupes); migration maps a legacy env to `[codex]` block; never clobbers a user-edited SOT.
  **Must NOT do**: Don't overwrite an existing user `~/.omo/config.jsonc` (seed only if absent; migrate additively). Don't delete env-var support. Don't migrate opencode's `oh-my-openagent.json` (out of scope). Don't write secrets.
  **Parallelization**: Wave 6 | Blocks: F | Blocked by: 12,14
  **References**:
  - `packages/omo-codex/plugin/scripts/auto-update.mjs:27-67` - the SessionStart-time migration runner to extend.
  - `packages/omo-codex/plugin/scripts/migrate-codex-config.mjs:19-40` - the existing config-migration pattern (read→transform→write) to mirror.
  - `packages/omo-codex/scripts/install/config.mjs` - install-time config writing (where seeding hooks in).
  - `packages/utils/src/jsonc-parser.ts` - comment-preserving read/write for the SOT.
  - todo 12 - the loader the seeded file must satisfy.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-codex` -> seed/migration tests pass (idempotent, additive, no-clobber).
  - [ ] In a temp HOME: run the seed step -> `~/.omo/config.jsonc` exists and `bun -e "const m=await import('./packages/utils/src/index.ts'); m.loadOmoConfig({harness:'codex',cwd:process.cwd(),homeDir:'<tmpHome>',env:{}})"` parses it without error.
  **QA scenarios**:
  - Scenario: seed creates a valid SOT scaffold once; second run is a no-op
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task15 -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task15 'set h (mktemp -d); cd /Users/yeongyu/local-workspaces/omo && env HOME=$h node packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs --seed; cp $h/.omo/config.jsonc /tmp/seed1.jsonc; env HOME=$h node packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs --seed; diff -q /tmp/seed1.jsonc $h/.omo/config.jsonc && echo IDEMPOTENT | tee .omo/evidence/task-15-seed.txt; env HOME=$h bun -e "const m=await import(\"./packages/utils/src/index.ts\"); console.log(m.loadOmoConfig({harness:\"codex\",cwd:process.cwd(),homeDir:process.env.HOME,env:{}})? \"PARSES\":\"NO\")" >> .omo/evidence/task-15-seed.txt' Enter`
      3. poll for `IDEMPOTENT` (loop shape above)
    Expected: file shows `IDEMPOTENT` and `PARSES` (seed is stable + loader-valid).
    Capture: the `tee`/append.
    Cleanup: `tmux kill-session -t ulw-qa-task15`; `rm -rf "$h" /tmp/seed1.jsonc`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-15-sot-seed-migrate/qa-seed-idempotent.txt
  - Scenario: existing user SOT is never clobbered by migration
    Tool: tmux
    Steps:
      1. `tmux new-session -d -s ulw-qa-task15e -x 200 -y 50 fish`
      2. `tmux send-keys -t ulw-qa-task15e 'set h (mktemp -d); mkdir -p $h/.omo; printf "%s" "{\"codegraph\":{\"watch_debounce_ms\":4242}}" > $h/.omo/config.jsonc; cd /Users/yeongyu/local-workspaces/omo && env HOME=$h CODEX_CODEGRAPH_ENABLED=0 node packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs; grep -q 4242 $h/.omo/config.jsonc && echo PRESERVED | tee .omo/evidence/task-15-seed-error.txt' Enter`
      3. poll file non-empty
    Expected: `PRESERVED` (user's `watch_debounce_ms:4242` survived; migration was additive, not a clobber).
    Capture: the `tee`.
    Cleanup: `tmux kill-session -t ulw-qa-task15e`; `rm -rf "$h"`; verify gone.
    Evidence: .omo/evidence/20260615-codegraph-omo-integration/task-15-sot-seed-migrate/qa-existing-preserved.txt
  **Commit**: Y | `feat(codex): seed + migrate ~/.omo SOT (additive, idempotent, env back-compat)` | Files: packages/omo-codex/plugin/scripts/migrate-omo-sot.mjs, packages/omo-codex/plugin/scripts/auto-update.mjs, packages/omo-codex/scripts/install/config.mjs, packages/omo-codex/plugin/scripts/test/migrate-omo-sot.test.mjs

## Final Verification Wave
> Runs in parallel after ALL todos. Each reviewer returns APPROVE or REJECT.
> Any REJECT -> fix -> re-run only the rejecting reviewer.

Evidence hygiene note for final reviewers (2026-06-15):
- The todo evidence references above intentionally point at the dated `.omo/evidence/20260615-codegraph-omo-integration/` tree. Do not resurrect root `.omo/evidence/task-*` paths.
- `.omo/evidence/final-qa/` remains the tracked F3 cross-harness QA bundle from commit `712972a59` and is intentionally not duplicated under the dated folder; duplicating it would reintroduce the duplicate-evidence problem this cleanup is avoiding.
- `.omo/evidence/20260615-todo9-codegraph-bootstrap-disabled-hooks/` remains a targeted Todo 9 / F4 gate-repair bundle for the disabled-hooks blocker. It is outside the main dated folder so reviewers can distinguish blocker repair evidence from the original todo evidence.
- `.omo/evidence/20260615-codegraph-resolution-platforms/` remains a targeted CodeGraph resolver/platform repair bundle for npm platform metadata, Windows shim, invalid env override, focused tests, and OpenCode QA evidence. It is outside the main dated folder so reviewers can distinguish cross-platform resolver repair evidence from the original todo evidence.
- `.agents/skills/work-with-pr/SKILL.md` and `.opencode/skills/work-with-pr/SKILL.md` are included as an F2 gate repair only: the project-skill reference test expected `task` delegation to use a real category. Evidence: `.omo/evidence/20260615-codegraph-omo-integration/final-f2-work-with-pr-skill-test.txt`.
- Do not mark F1-F4 complete from this hygiene pass alone; final reviewers must still rerun/approve those boxes.

- [ ] F1. Plan compliance audit - read the plan end-to-end; verify every Must Have exists (read file / run command), every Must NOT Have is absent (search, reject with file:line), every `.omo/evidence/` file exists.
- [ ] F2. Code quality review - typecheck + lint + full test suite (both bundles + packages/utils); review changed files for `as any` / empty catches / debug prints / dead code / slop / 250-LOC ceiling.
- [ ] F3. Real manual QA - from clean state, execute EVERY QA scenario from EVERY todo plus cross-harness integration (fresh-repo first-session→second-session tool activation; binary-missing skip; symlink conflict) and save evidence to `.omo/evidence/final-qa/`. Opencode-spawning QA runs in an isolated XDG sandbox with the before/after `opencode.db` session-count isolation proof; codex-spawning QA runs under an isolated `CODEX_HOME` (AGENTS.md §OPENCODE/§CODEX).
- [ ] F4. Scope fidelity check - per todo, diff spec vs actual changes: nothing missing, nothing beyond spec (esp. no opencode SOT migration, no cross-bundle import), no unaccounted files.

## Commit strategy
- See each todo's **Commit** line. One atomic commit per todo on a feature branch off `dev`; pre-commit runs the todo's acceptance commands. Do not commit the dirty_worktree `bin/` artifacts.

## Success criteria
### Verification commands
```bash
# opencode: codegraph MCP present & enabled when binary resolvable
# (run inside an isolated XDG sandbox per AGENTS.md opencode-qa — see todo 9; never touch the real opencode.db)
for v in XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; set -x $v (mktemp -d); end; mkdir -p $XDG_CONFIG_HOME/opencode; printf '{"plugin":["%s/packages/omo-opencode/dist/index.js"]}' $PWD > $XDG_CONFIG_HOME/opencode/opencode.jsonc
opencode run --format json "list mcp tools" 2>/dev/null | grep -i codegraph   # Expected: codegraph_* tools listed (after index exists)
# codex: SessionStart component runs and reports a JSON outcome
node packages/omo-codex/plugin/components/codegraph/dist/cli.js hook session-start   # Expected: JSON with codegraph bootstrap status, exit 0
# storage model (adoption rule: a pre-existing real dir stays in-place; only a FRESH repo gets a symlink)
ls -ld "$PWD/.codegraph"   # Expected: a real directory if it pre-existed (e.g. THIS repo), OR a symlink → ~/.omo/codegraph/projects/<slug> for a fresh repo
# SOT resolution
bun -e "const m=await import('./packages/utils/src/index.ts'); console.log(JSON.stringify(m.loadOmoConfig({harness:'codex',cwd:process.cwd(),env:{}}).config.codegraph||{}))"   # Expected: base deep-merged with [codex]
# license ship
tar -tf "$(npm pack --silent)" | grep THIRD-PARTY-NOTICES   # Expected: file present in tarball
```
### Final checklist
- [ ] All Must Have present
- [ ] All Must NOT Have absent
- [ ] All QA evidence captured under .omo/evidence/
