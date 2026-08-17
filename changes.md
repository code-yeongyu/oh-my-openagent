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
