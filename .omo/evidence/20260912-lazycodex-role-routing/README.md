# LazyCodex role routing verification

Tracker: code-yeongyu/lazycodex#134. Source change only; distribution sync is separate.

## Scope and expected impact

Native Codex spawns must select one of the bundled LazyCodex roles or fail explicitly. Bootstrap and installer provide an internally named medium-worker default for unnamed non-forks, preserve user-owned defaults, and consume the existing unified `agents.default.disable` setting. The Codex-only directive and generated skill guidance follow actual schema capabilities. Senpi role admission and existing fan-out/artifact guards remain unchanged.

## Failing-first evidence

- `bun test packages/omo-codex/src/install/default-agent-role.test.ts`: initial 0 pass / 5 fail, demonstrating missing default installation and missing conflict rejection.
- Focused Vitest native matrix: initial 10 pass / 32 fail, demonstrating generic and unnamed requests passing before any plan existed.
- Added dangling-symlink test failed before the ownership check was tightened; malformed hook-input test failed before CLI failure became an explicit denial.
- Built-bootstrap integration: all 3 new scenarios failed against the old artifact before rebuilding.

## GREEN verification

- `bun run test:codex`: passed. LSP suite 97/97; ULW suite 600/600; installer/core Bun suite 475 passed, 0 failed, one existing Windows-only named-pipe test skipped on the macOS host; generated plugin/installer Node suite 499/499. No tests were deleted or newly skipped.
- `bun run --cwd packages/omo-codex typecheck`: passed.
- ULW `bun run lint` and `bun run typecheck`: passed.
- Real plugin build regenerated the bootstrap and component bundles plus directive/skill copies; installer build regenerated committed `scripts/install-dist/install-local.mjs`.
- Built-bootstrap/component dependency checks passed: no external non-Node imports or local TypeScript siblings. Bootstrap ownership/config integration and bundled hook-CLI contracts passed (16/16 focused aggregate tests).
- Role registry test compares explicit selector names to the shipped TOML names, not prompt prose.
- Budget tests now target the extracted unchanged budget stage; native entry-point matrix, admission-breaker composition, and compiled CLI cases independently verify role enforcement plus budget integration.

## First-party live Codex QA

Used the codex-qa app-server client against a local Responses mock in a disposable Linux arm64 Docker container with Codex 0.154.0. Installed the freshly built local packaged payload into an isolated home. Source mounted read-only; no host Codex home or credentials were mounted. The mock waits on its listening event, the client waits on native notifications with a bounded deadline, and all eight cells execute without sleeps or polling. Container removal and isolated-home deletion are automatic.

Observed all eight named/unnamed x registered/unregistered x fork/non-fork scenarios:
- Named registered non-fork returned an agent id and `Medium Worker` nickname; the live schema listed both medium-worker and configured default profiles.
- Named registered full-history passed the LazyCodex guard but Codex 0.154.0 explicitly rejected role override on that fork. This satisfies the allowed loud-failure outcome; do not drop the role to evade the rejection.
- Named generic worker, either fork mode: native `hook/completed` status `blocked`, with explicit LazyCodex role denial.
- Unnamed, either fork mode and either unused registry-axis value: native `hook/completed` status `blocked`, with explicit LazyCodex role denial.
- SessionStart and UserPromptSubmit completed in every case. The installed default had internal `name = "default"` and its expected config registration.

`live-summary.json` records the sanitized outcomes. Raw logs remain local. The live schema exercised V1; V2 tokens and fork inputs are covered by deterministic unit and compiled-hook tests, not claimed as a live V2 run.

## Limits and omitted data

The pre-tool payload has no schema metadata. Legacy schemas lacking `agent_type` therefore fail closed when guarded; prompt-carried role descriptions remain a documented fallback, not TOML selection. An unguarded unnamed full-history fork still bypasses role application upstream. No claim is made that LazyCodex config fixes that path or that a disabled/untrusted hook enforces anything.

No real model API, host configuration, credentials, private environment dumps, or personal/company identifiers were used or included. Docker's first attempt to update a system-owned Codex installation failed with EACCES; the successful run installed Codex under a writable disposable prefix. The generic live-client initially regarded the expected blocked hook as a failed QA run; the matrix driver now asserts that exact native blocked result instead of treating a policy denial as hook malfunction.
