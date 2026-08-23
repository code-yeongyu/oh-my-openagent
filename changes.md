## 2026-08-20 — Demand parent-side verification of DAG completions

A DAG node's completion summary was delivered to the orchestrating parent as if
it were established fact, so a node that overstated or fabricated its work could
satisfy the parent without a single artifact being read. Model-facing DAG
completion payloads now carry an explicit verification directive: reconstruct the
node's owed scope from its prompt, open the files and run the commands it claims,
verify each deliverable with the parent's own tool calls, and send corrective
instructions back to the same node until that verification passes.

`CompletionDetails` gains an optional `dag` block (`run_id`, `node_id`) sourced
from the task record's DAG owner, so the parent can address the exact node it
must correct. `buildCompletionMessage` appends the directive once per message
whenever any batched detail is DAG-owned, and run-level terminal wakes
(completed, failed, cancelled) append it to their injection content. A plain
non-DAG completion keeps byte-identical content, and `dag.run.paused` stays
directive-free because a pause is not a completion claim. The width-rendered TUI
path is untouched: `completionMessageLines` and the task-completion renderer
still render from `details`, so this changes only what the model reads.

## 2026-08-18 — Rebuild the Sisyphus runtime prompt on same-family model switches

The Sisyphus runtime prompt reconciler skipped every rebuild whose runtime
model shared the configured model's broad prompt family. The `fallback`
family is not prompt-uniform: `buildFallbackSisyphusPrompt` applies
Gemini-specific override blocks, and other families bake model-dependent
sections (GPT identity text, claude/non-claude planner sections). Switching
between same-family models in the TUI (e.g. Gemini -> MiniMax-M3 or
DeepSeek -> MiniMax-M3) therefore kept the previous model's baked prompt in
place, and the active model reported a stale identity (issue #6966).

The reconciler now skips only when the runtime model is exactly the model the
baked prompt was built for, and the existing rebuilt-versus-baked equality
check suppresses genuine no-op switches (DeepSeek and MiniMax bake
byte-identical fallback bodies, verified against the real prompt builder).
The system-transform handler canonicalizes the opencode hook model record to
`<providerID>/<id>` so bare builtin-provider ids compare exactly. Rebuild work
per request is unchanged for cross-family switches; same-family switches now
rebuild like cross-family ones already did.

## 2026-08-18 — Respect user permission.task on OMO main agents

`applyToolConfig` built the permission object for sisyphus, atlas, hephaestus,
and prometheus by spreading the agent's existing permission first and then
hardcoding `task: "allow"` on top, so any user-configured `permission.task`
was silently discarded while the config looked applied. The default is now
injected before the spread, which keeps `task: "allow"` when the user
configured nothing and lets an explicit user value win otherwise.

The plugin-injected rules that fence delegation (`call_omo_agent: "deny"`,
`task_*`, `teammate`, todo denials, prometheus bash denials) still apply after
the user permission, so only the `task` default changed precedence. Verified
against a real isolated `opencode serve` boot with a user-layer
`[opencode].agents.<agent>.permission.task` override for all four agents, plus
a negative-control boot without user config. Object mappings for
`permission.task` and a configurable deny list remain follow-ups tracked in
the issue.

## 2026-08-18 — Resolve configured category model chains against availability

OpenCode category `models` chains now skip entries that are absent from the connected provider catalog before creating the delegated session. The configured order and per-entry settings remain intact, and fuzzy-normalized model IDs resolve to the provider's available spelling instead of being discarded.

When no configured entry is available, delegation still fails rather than selecting an unrelated default, but the error now names the complete configured chain. Cold-cache behavior remains unchanged until an availability catalog exists.

## 2026-08-17 — Track Senpi 2026.8.17 for the omo-ai beta line

All active native Senpi pins now use `2026.8.17` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The lockfile resolves the complete 2026.8.17 companion family while
the existing Pi `0.84.2` compatibility overrides remain unchanged because
the upstream manifest changed only its Senpi package aliases.

The hand-derived provider registry was checked against the new engine. Its
provider IDs are unchanged, while the upstream Cerebras catalog no longer
advertises `zai-glm-4.7`; only the derivation version changes locally. This is
a host dependency update, not an OMO extension behavior change, so extension
source stays untouched and committed bundles are refreshed only from the
normal build. Conflict zones are the exact manifest pins, `bun.lock`, the
provider-map derivation comment, and generated Senpi extension artifacts.

## 2026-08-18 — Ship @babel/parser with omo-ai for bundled Senpi codemode

`@code-yeongyu/senpi@2026.8.16` bundles the source-only
`@code-yeongyu/senpi-codemode` extension but its bundled-dependency closure
omits the Babel parser that `senpi-codemode/src/kernels/js/rewrite-imports.ts`
imports at runtime. Clean `omo-ai` installs therefore logged a non-fatal
`Failed to load extension ... Cannot find module '@babel/parser'` warning at
boot and silently lost codemode/eval surfaces (verified on a real isolated
`omo-ai@5.0.0-0.beta.8` install: 43 extensions loaded, `senpi-codemode`
absent).

`omo-ai` now declares `@babel/parser@8.0.4` as a direct exact-pinned runtime
dependency. npm installs the full transitive Babel closure next to Senpi, so
the bundled codemode extension resolves its import and loads enabled. This is
a deliberately duplicative downstream compatibility dependency until Senpi
publishes a complete bundle; remove it at the next Senpi pin bump only after
isolated packed-install and RPC boot QA prove the upstream fix.

## 2026-08-17 — Make explicit beta publication ownership-safe

The synchronized `/publish` command and skill now accept an exact semantic version in addition to `patch`, `minor`, and `major`. Exact versions are dispatched through the workflow's `version` input, and the returned workflow run ID is the sole owner followed through release completion; latest-run inference is no longer part of the command.

Prerelease changelogs now compare against the preceding release in the same channel, and GitHub releases explicitly carry prerelease metadata. Stable bump behavior remains unchanged. Senpi RPC model admission diagnostics also report the probed catalog size and child stderr tail while the launch-parity test keeps its process environment fixed at module load.

## 2026-08-16 — Track Senpi 2026.8.16 for the omo-ai beta line

All active native Senpi pins now use `2026.8.16` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The companion Pi compatibility line moves from `0.84.1` to `0.84.2`
to match the upstream host contract incorporated by this Senpi release.

The workspace lockfile, manifest-shape tests, and builtin-provider map move
with the exact engine pin. Senpi 2026.8.16 adds Cursor as a builtin
authentication provider, so the native provider map now includes `cursor`.
Keep these surfaces aligned whenever Senpi changes; a manifest-only update is
incomplete because the published native payload and generated adapter bundle
consume the resolved dependency graph.

## 2026-08-13 — Track Senpi 2026.8.13 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.13` across the root, native
launcher, OmO Senpi adapter, and task engine. Senpi 2026.8.13 adds `baseten`
and `qwen-token-plan-individual`; this update also synchronizes the local map
with the already-available `opengateway` provider. Keep
`packages/omo-native/bin/lib/provider-map.json` synchronized with
`builtinProviders()` whenever the shared pin moves.

The lockfile must move with the exact pins. The focused pin tests continue to
reject manifest drift, while the provider-map contract now compares the local
map directly with the installed engine registry.

## 2026-08-06 — Model packed Senpi installs in compatibility fixtures

The root Senpi compatibility fixture now passes the packed plugin path explicitly when exercising
`runSenpiInstaller`. This keeps the hermetic packed-layout test on the immutable verification path
after source installs began rebuilding generated artifacts unconditionally.

Future compatibility fixtures must choose the installer mode deliberately: omit `pluginPath` only
for a real source-tree refresh, and provide it when modeling a published or packed plugin.

## 2026-08-11 — Publish native task lifecycle snapshots over RPC

The OmO Senpi task component now emits safe `omo.task.updated` snapshots on session start and every
task-store mutation. Snapshots are scoped to the captured parent session and include only display,
model, lifecycle, residency, timing, and optional terminal run-stat fields; durable notification and
root-session bookkeeping must never cross the RPC boundary. Older Senpi hosts without `pi.rpc`
remain a no-op compatibility path.

## 2026-08-12 — Require the request-capable Senpi release

All native Senpi workspace pins now use `2026.8.11-6`, the first published release that exposes
`pi.rpc.handle`, `extension_request`, and `RpcClient.requestExtension`. Earlier releases can still
receive extension events but cannot serve desktop task send/cancel/output requests.

Keep the root, native launcher, OmO Senpi adapter, and task engine pins aligned. Downgrading any one
of them to an emit-only host silently turns the interactive task panel back into telemetry-only UI.

## 2026-08-12 — Track Senpi 2026.8.12-4 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.12-4` (root, native launcher, OmO Senpi adapter, and
task engine), moving the omo-ai 5.0.0 beta line onto the Senpi 2026.8.12 engine train. The
four-surface alignment rule above still holds: `packages/omo-native/test/senpi-pin.test.ts` fails any
manifest that drifts from the shared pin, so all four move in one commit.

## 2026-08-13 — Record the OmO 5.0.0 beta.7 release

Release PR #6797 merged the `v5.0.0-beta.7` source state at
`923726cdeb0bd0c1d60cdf83dc4cf6fe1117a548` and published
`omo-ai@5.0.0-0.beta.7`. The published package pins
`@code-yeongyu/senpi@2026.8.12-4`; future release preparation must keep the
root, `omo-native`, `omo-senpi`, `senpi-task`, lockfile, generated extension
bundle, and pin tests aligned before tagging.

The release also includes `d694add58dd1` (`fix(omo-native): emit doctor report
atomically`). Doctor output now becomes visible only after a complete report is
ready, so consumers must not reintroduce partially written report files or
split the atomic write path during future release refactors.

## 2026-08-18 — Make the lsp-daemon test budget dominate its subprocess budgets

`packages/lsp-daemon/vitest.config.ts` declared no `testTimeout`, so vitest's
5s default applied while `test/qa-driver-portability.test.ts` granted its `bun`
cancellation smoke 10s (an `execFileSync` timeout and a `setTimeout` guard
around its `spawn`). The harness therefore killed the test before the inner
guard could ever fire, so a slow-but-correct subprocess reported `Test timed out
in 5000ms` instead of an assertion result. Windows CI runners routinely spend
more than 5s spawning `bun`, which is why "Run vendored lsp-daemon tests" failed
on `windows-latest` with no product defect behind it.

The package now sets `testTimeout`/`hookTimeout` to 30s, exported from the
config as `TEST_TIMEOUT_MS` alongside the documented `MAX_IN_TEST_BUDGET_MS`
ceiling of 10s. The invariant is that the harness budget strictly exceeds every
budget a test grants a subprocess or timed promise; `test/test-timeout-budget.test.ts`
reads both the configured value and the real budgets out of the test sources and
fails if that ordering is ever reintroduced. Keep the bound proportionate: it
exists to survive a cold Windows process spawn, not to hide a genuine hang.
