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
