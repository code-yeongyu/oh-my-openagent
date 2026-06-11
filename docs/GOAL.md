# Target Adapter Full Parity Closure

Date: 2026-06-11

This goal re-opened the prior certification limitations and treated them as implementation bugs, not documentation footnotes. The four remaining gaps are implemented in source, covered by targeted checks, built into fresh `dist`, and dogfooded through the installed Oh My Pi and Pi loaders. Full root `bun test` was not rerun after the final fixes because the user explicitly requested targeted tests only.

## Completed Items

- `look_at` is registered for Pi and Oh My Pi target adapters through `registerGatedRuntimeTools()`.
  - Implementation: `src/host-tools/look-at-tool.ts`
  - Behavior: prepares the same source `look_at` inputs, materializes clipboard/base64 images when needed, runs the target CLI in print mode with an `@file` attachment, waits for stdout, and returns the multimodal analysis result.
  - Proof: `src/host-tools/look-at-tool.test.ts`, `src/host-tools/gated-runtime-tools.test.ts`

- Target Team Mode now creates source-style runtime state, worktree directories, inboxes, tasks, mailbox messages, and tmux layout metadata.
  - Implementation: `src/host-tools/team-tools.ts`
  - Behavior: all 12 `team_*` tools remain gated behind `OMO_TEAM_MODE=1`; `team_create` writes source Team Mode runtime state under `.omo/target-team-mode`, creates per-member worktree directories through the source registry paths, creates inbox directories, and automatically attempts a tmux layout when tmux is available.
  - Proof: `src/host-tools/team-tools.test.ts`

- Target runtime fallback now replays the failed turn after selecting a fallback model.
  - Implementation: `src/host-hooks/provider-fallback.ts`
  - Behavior: `before_provider_request` records the last user prompt from provider payloads; retryable `after_provider_response` failures and assistant error messages select the next available source fallback model, then enqueue the failed prompt once through `sendUserMessage(..., { deliverAs: "followUp" })`.
  - Proof: `src/host-hooks/provider-fallback.test.ts`

- Skill MCP OAuth is exercised through a real local OAuth flow.
  - Implementation: `src/features/mcp-oauth/oauth-authorization-flow.ts`, `src/features/mcp-oauth/discovery.ts`
  - Behavior: production browser launch remains unchanged; tests can inject a browser opener, and OAuth discovery now permits plain HTTP only for loopback hosts. The local live test runs protected-resource discovery, authorization-server discovery, dynamic client registration, PKCE authorization redirect, callback server handling, token exchange, and token storage.
  - Proof: `src/features/mcp-oauth/provider-live-local.test.ts`

## Verification Run

Focused source verification:

```bash
timeout 180s bun test src/host-tools/gated-runtime-tools.test.ts src/host-tools/look-at-tool.test.ts src/host-hooks/provider-fallback.test.ts src/host-tools/team-tools.test.ts src/features/mcp-oauth/provider-live-local.test.ts src/features/mcp-oauth/provider.test.ts src/features/mcp-oauth/discovery.test.ts
```

Result after the final fixes: passed, 37 tests, 93 assertions.

Expanded targeted adapter verification:

```bash
timeout 180s bun test src/host-resources/command-registration.test.ts src/host-resources/resource-discovery.test.ts src/host-hooks/hook-registration.test.ts src/host-hooks/message-transforms.test.ts src/host-hooks/continuation.test.ts src/host-hooks/tool-guards.test.ts src/host-hooks/openclaw.test.ts src/host-agents/agent-routing.test.ts src/host-tools/always-on-tools.test.ts src/host-tools/mcp-backed-tools.test.ts src/host-tools/hashline-edit-tool.test.ts src/host-tools/task-tools.test.ts src/host-tools/tool-normalization.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/hosts/pi/register-diagnostics.test.ts src/cli/install-targets/install-target-extensions.test.ts
```

Result: passed, 46 tests, 106 assertions.

Typecheck:

```bash
timeout 240s bun run typecheck
```

Result: passed across root, script, and workspace package tsconfigs.

Build:

```bash
bun run build
```

Result: passed and emitted fresh `dist/index.js`, `dist/hosts/oh-my-pi/index.js`, and `dist/hosts/pi/index.js`.

Installed-runtime dogfood:

```bash
OMO_TEAM_MODE=1 bun -e '<installed Oh My Pi loader probe>'
OMO_TEAM_MODE=1 bun -e '<installed Pi loader probe>'
```

Oh My Pi result from the latest installed-loader dogfood:

```json
{
  "errors": [],
  "loaded": "/home/supreme/.omp/agent/extensions/oh-my-openagent-dev/dist/hosts/oh-my-pi/index.js",
  "toolCount": 41,
  "commandCount": 10,
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Oh My Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "skillPaths": 3,
  "promptPaths": 2,
  "teamStatus": "active",
  "teamMembers": 2,
  "worktreesExist": true,
  "tmuxSession": "omo-target-team-a29c715f",
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

Pi result from the latest installed-loader dogfood:

```json
{
  "errors": [],
  "loaded": "/home/supreme/.pi/agent/extensions/oh-my-openagent-dev/dist/hosts/pi/index.js",
  "toolCount": 41,
  "commandCount": 10,
  "hasLookAt": true,
  "teamTools": 12,
  "diag": "Oh My OpenAgent Pi adapter loaded.",
  "mcpHasLsp": true,
  "taskCreated": true,
  "skillPaths": 3,
  "promptPaths": 2,
  "teamStatus": "active",
  "teamMembers": 2,
  "worktreesExist": true,
  "tmuxSession": "omo-target-team-a8545cfb",
  "tmuxPanes": 2,
  "tmuxSessionLive": true
}
```

The dogfood probes ran from temporary working directories, verified live tmux sessions with two panes, and killed the target tmux sessions before exit.

Real headless LLM user-flow dogfood:

```bash
--model xiaomi-mimo/mimo-v2.5-pro --thinking medium
```

Oh My Pi:

- Ran `omp --mode text --print --no-title` from a temp project with `sample.txt`.
- Prompt required actual tool use: `omo_diagnostic`, `mcp_servers`, `task_create`, and reading `sample.txt`.
- Result: exit 0. The final answer reported `DIAG_LOADED: YES`, `MCP_LSP: YES`, `TASK_CREATED: YES`, and `SAMPLE_READ: YES`.
- Disk artifact confirmed: `.omo/tasks/T-b1ac97ef-8f22-43b2-a0d1-abc7eb4b36c3.json`, subject `headless dogfood omp ascii`, `threadID: "target-session"`.
- A previous non-ASCII Oh My Pi proof created a task artifact, then failed in MiMo stream parsing with `Could not parse message into JSON` on a split Unicode token. The ASCII proof completed the adapter flow.

Pi:

- The normal agent dir loaded OMO but failed on conflicts from another installed extension, `pi-hermes-memory`, over `skill` and `session_search`.
- Reran with isolated `PI_CODING_AGENT_DIR`, copying only the model catalog and symlinking only OMO into `extensions`.
- Ran `pi --mode text --print` from a temp project with `sample.txt`.
- Prompt required actual tool use: `omo_pi_diagnostic`, `mcp_servers`, `task_create`, and reading `sample.txt`.
- Result: exit 0. The final answer reported `DIAG_LOADED: YES`, `MCP_LSP: YES`, `TASK_CREATED: YES`, and `SAMPLE_READ: YES`.
- Disk artifact confirmed: `.omo/tasks/T-4e6c88b4-c317-430d-b2a2-1c8a0552d3d3.json`, subject `headless dogfood pi proof`, `threadID: "target-session"`.

Focused runtime fix verification:

```bash
bun build src/hosts/oh-my-pi/index.ts src/hosts/pi/index.ts --root src --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
bun run build:node-require-shim
bun test src/hosts/pi/register-diagnostics.test.ts src/hosts/oh-my-pi/register-diagnostics.test.ts src/shared/dist-bundle-bun-globals.test.ts
node --input-type=module -e "const pi = await import('./dist/hosts/pi/index.js'); const omp = await import('./dist/hosts/oh-my-pi/index.js'); console.log(typeof pi.default + ':' + typeof omp.default)"
```

Result: host bundle rebuild passed, 7 focused tests passed with 21 assertions, and Node import smoke printed `function:function`.

Full feature headless rerun:

- Run root: `/tmp/omo-full-harness-run-SqPtny`
- Isolated Pi agent dir: `/tmp/omo-pi-agent-run-CFfR30`
- Temp LSP dependency path: `/tmp/omo-full-harness-run-SqPtny/lsp-deps/node_modules/.bin`

Fixes made during the wider real-flow pass:

- Team Mode target tools now accept `name` as an alias for `team_name`.
- Team Mode target tools now expose a concrete schema for `members`, `subject`, `body`, and related fields, so headless model tool calls reliably create two-member teams.
- Comment checker and OpenCode binary resolver default `Bun.which` callsites now use `bunWhich`, avoiding `Bun is not defined` under Pi's Node-style extension loader.
- The dist bundle Bun-global audit now scans `dist/index.js`, `dist/hosts/oh-my-pi/index.js`, and `dist/hosts/pi/index.js`.

Focused verification for those fixes:

```bash
bun test src/host-tools/team-tools.test.ts
bun test src/shared/dist-bundle-bun-globals.test.ts src/hooks/comment-checker/cli.test.ts src/cli/run/opencode-binary-resolver.test.ts
```

Result: Team Mode tests passed, 2 tests and 14 assertions. Bundle/raw-Bun plus resolver tests passed, 22 tests and 38 assertions.

Oh My Pi wider proof:

- Broad `omp --mode text --print --no-title` run covered diagnostics, MCP inventory, LSP, ast-grep, glob, grep, task create/list, hashline attempt, and Team Mode.
- LSP initially failed because `typescript-language-server` was missing. After temp installing `typescript` and `typescript-language-server` and prepending PATH, the narrow rerun passed and found `add` and `multiply`.
- Team Mode initially exposed a real user-flow issue: the model used `name`, creating `default`. After the alias/schema fix, the narrow rerun passed with `teamName: "ompmembers"` and both `sisyphus` and `atlas` in persisted runtime state.
- Hashline broad flow fell back to ordinary write because target read output did not provide line hashes. A narrow real harness proof with explicit anchor `9#TY` passed valid edit and rejected stale `9#ZZ`.
- Persisted proof included `.omo/tasks/T-69522cd6-35e5-4526-9735-51a72631127a.json`, Team Mode state for `ompmembers`, and task `two member task`.

Pi wider proof:

- Broad isolated `pi --mode text --print` run covered diagnostics, MCP inventory, LSP, ast-grep, glob, grep, task create/list, hashline edit, and Team Mode.
- Broad run passed everything except the first ast-grep pattern, which missed exported functions. Narrow rerun with `export function $NAME($$$ARGS): $RET { $$$BODY }` passed and found `add` and `multiply`.
- Broad run initially printed two `Bun is not defined` extension errors. After replacing raw `Bun.which` defaults and widening the dist audit, a post-fix Pi smoke run reported diagnostics and MCP inventory with no `Bun is not defined` or `Extension error`.
- Persisted proof included `.omo/tasks/T-4c28bdf3-a0da-4cf8-9689-920bb7048a7c.json`, `src/hashline-target.ts` containing `hashlineValue`, Team Mode state for `pimembers` with both `sisyphus` and `atlas`, task `pi team proof`, and message inbox files for both members.

Root suite:

- `bun test`

Result: attempted after the OAuth callback-port fix. It later surfaced two targeted issues that were fixed with narrower regressions: OAuth live-local fetch/global timing and a consensus-removal audit timeout. After those fixes, the user explicitly requested no more full root test runs because the suite is resource-heavy. Current proof is therefore targeted, not a fresh whole-repo `bun test`.

Pi source check:

- `npm run check` failed before dependency install with `biome: command not found`.
- After `npm ci`, `npm run check` failed in `packages/web-ui` with missing workspace declaration outputs such as `TS2307: Cannot find module '@mariozechner/pi-agent-core'`.
- `/home/supreme/pi-mono/README.md` says `npm run check` requires `npm run build` first because web-ui needs compiled `.d.ts` files. The goal forbids running Pi `npm run build`, so this remains a pre-existing check precondition rather than a port failure.

## Final State

No limitation is carried for source implementation of target Team Mode tmux/worktree activation, target failed-turn replay, Skill MCP OAuth local exercise, LSP/MCP inventory, ast-grep, task persistence, hashline edit execution, or real headless feature-flow testing. Runtime certification now includes installed loader dogfood plus broad and narrow real headless tool-use flows through Oh My Pi and Pi using Xiaomi MiMo v2.5 Pro medium. Full root `bun test` remains intentionally not current by user instruction. Live LLM-backed `look_at` and delegated subagent execution were not run because that would spend configured provider credentials; `look_at` remains covered by focused source tests and installed registration dogfood.
