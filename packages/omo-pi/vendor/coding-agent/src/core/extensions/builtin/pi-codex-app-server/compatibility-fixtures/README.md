# pi-codex-app-server Compatibility Fixtures

These fixtures lock PR-001 contract shape only. They do not start sockets,
child processes, app-server connections, timers, or runtime routing.

App-server IDs remain authoritative. External IDs are correlation metadata only:
`thread_id`, `session_id`, `turn_id`, `item_id`, and `RequestId` from app-server
payloads must remain intact inside semantic projections and opaque envelopes.

Fixture groups:

- `external_to_app`: external JSON-RPC requests that later PRs must map to app-server methods.
- `app_to_external`: app-server notifications and server requests that later PRs must project.
- `backpressure`: lossless and best-effort stream-class contract samples.
- `reconnect`: snapshot-plus-new-stream resume contract samples.
- `schema-snapshots`: reviewer-readable frozen protocol summary.
- `evidence-packet-template`: file templates every PR evidence packet should fill.
