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
