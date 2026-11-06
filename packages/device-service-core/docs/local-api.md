# Local API v1

The local API is how every OmO process on a device reaches the one device service process that owns the device's
connection: the desktop app, the `omo` CLI and the installer. It is versioned by `v` (this document is version 1) and
generic: nothing in it names the transport the service uses between devices. The TypeScript vocabulary is
`packages/local-api/src/protocol.ts` (with `vocabulary.ts` and `protocol-events.ts`); the conformance fixtures in
`packages/local-api/test/conformance/fixtures/` are the oracle any server or client implementation runs against.

## Wording

No name, value or documented sentence of this API contains a word that belongs to the transport between devices or to
a particular device role. The transport-neutral words are: `transport` (the connection between devices),
`Connected` (the state label shown to users) and `owner_transfer` (the service being replaced). Clients show the
connection state only, never a path or a route. A gate test (LA18) scans `protocol.ts`, `protocol-events.ts`,
`vocabulary.ts` and this file for those words.

## Transport and access

| Platform     | Endpoint                                                                                  | Protection                                                             |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| macOS, Linux | Unix socket `<state dir>/service.sock`                                                    | state dir 0700, socket and every file 0600, all owned by the user      |
| Windows      | loopback TCP `127.0.0.1:<port>`, the port in `<state dir>/endpoint.json` as `{"port": n}` | an exact protected DACL on the state dir and every secret-bearing file |

The state dir is `~/.omo/device-service/` (`%LOCALAPPDATA%\OmO\device-service\` on Windows). It holds `token`,
`service.sock` or `endpoint.json`, and the service's own files.

POSIX client check, before any connection is opened: the state dir, `service.sock` and `token` exist as themselves
(`lstat`: a symlink is refused), belong to the client's uid, and have no group or world bits. Anything else is refused
`insecure_state_dir`, and nothing is created. A Windows client relies on the per-user profile location, which only
the user and administrators can write, and on the DACL the service verified; it does not read the DACL again on every
connection.

Windows exact DACL, applied by the service and the installer and verified before `token`, `endpoint.json` or any
other secret is written, on every start: a fresh `DirectorySecurity`/`FileSecurity` with
`SetAccessRuleProtection($true, $false)`, `SetOwner(<user SID>)` and exactly one
`FileSystemAccessRule(<user SID>, FullControl, ContainerInherit|ObjectInherit, None, Allow)` (files: no inheritance
flags), written with `Set-Acl -AclObject` so the DACL is replaced. The verification reads the raw security
descriptor straight from Win32 (`GetNamedSecurityInfoW`, then
`ConvertSecurityDescriptorToStringSecurityDescriptorW` for the owner and the DACL; never .NET's `Get-Acl` rules,
which can hide ACE kinds such as conditional or callback ACEs) and requires the SDDL to be exactly
`O:<user SID>D:PAI(A;OICI;FA;;;<user SID>)` for a directory and `O:<user SID>D:PAI(A;;FA;;;<user SID>)` for a
file: protected and auto-inherited, one allow ACE for the user with full access. Any other ACE type (deny,
object, conditional or callback, audit, alarm, label, resource attribute), a second ACE, any unknown token and any
text that does not parse is refused. Any other result, and any result that cannot be read, is
`insecure_state_dir`: the service stops before the secret exists. `icacls /inheritance:r /grant:r` is not a
substitute: it keeps an explicit `Everyone` grant (LA17b).

A secret file is created empty, protected, verified, written, then renamed into place.

## Framing

LF-delimited UTF-8 JSON, one object per line. A line is at most `LOCAL_LINE_MAX = 1,048,576` bytes, the LF not
counted. A reader that meets a longer line drops it up to its LF, reports it once, and continues with the next line
(resynchronization). A writer never produces such a line; any payload whose line would exceed
`LOCAL_INLINE_MAX = 524,288` bytes is chunked or paged instead (below).

## Handshake and mutual proof

```
client                                   service
  hello {v, client, client_nonce}  --->
                                   <---  welcome {v, service_version, owner, server_proof, server_nonce,
                                                  capabilities, state}   or   refused {reason}
  (reads <state dir>/token fresh, verifies server_proof; disconnects on a mismatch)
  authenticate {id, client_proof}  --->
                                   <---  response {id, ok: true, data: {}}
  requests and events from here on
```

- `token`: 32 random bytes, written as 43 base64url characters, new on every service start.
- Nonces: 32 random bytes, 43 base64url characters each.
- `server_proof = base64url(HMAC-SHA256(token, "server" || client_nonce || endpoint))` and
  `client_proof = base64url(HMAC-SHA256(token, "client" || server_nonce || endpoint))`, over the nonce's 32 raw bytes
  followed by the UTF-8 `endpoint`. `endpoint` is `tcp:<port>` on Windows (decimal, no leading zeros: the loopback
  port the service listens on, and for the client the port it read from `endpoint.json` and connected to) and `unix`
  on POSIX (the socket in the private state dir). Binding both proofs to the endpoint means that forwarding through a
  stale port that another local user grabbed after the service moved fails on both sides. Each `welcome` carries a fresh
  `server_nonce`, so a `client_proof` from one connection is refused on any other (`client_proof_invalid`, then close).
- Vectors: token `ERERERERERERERERERERERERERERERERERERERERERE` (32 x 0x11), nonce
  `IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI` (32 x 0x22):
  - endpoint `unix`: `server_proof` is `TLdIwpwhlMugnecRwFIoNTrwIxH9HjwJ98_hpMaqKIQ`, `client_proof` is
    `sfkHyU_lyf5fLfS9ag1RJI50KPgq4iqBCOXFWn8e0N8`;
  - endpoint `tcp:49152`: `server_proof` is `4BSzSrSHpBmfLPEkF5-xi39PnUfJO5W3RZKOZNDa0fc`, `client_proof` is
    `ODo5pWCMHx-GmOQOtLWFbYYNCUqJp-ZChkEqTbVjcAo`.

The client sends nothing but its `hello` until the `server_proof` verifies, so a server that cannot read the token
never receives a request, let alone `device.adopt`. The client reads the token after the `welcome`, never from a
cache: a restarted service has a new one. The service answers every request other than `authenticate` with
`unauthenticated` until the client proof verifies, and executes none of them; a wrong `client_proof` is answered
`client_proof_invalid` and the connection is closed.

`hello` is `{"type": "hello", "v": 1, "client": {"name": "desktop" | "omo" | "installer" | "sdk", "version": "<semver>",
"data_home": "<absolute path>"}, "client_nonce": "<nonce>"}`; `data_home` is the home the desktop app resolved and is
present for `desktop` clients only. The service reads `v` before the shape. `refused` reasons: `version` (another
`v`), `data_home_required` (a desktop client without it), `malformed` (anything else, including a first line that is
not a `hello`). `welcome.owner` is `service`; `capabilities` are `sessions`, `devices`, `enforcement`, `upgrade`, `control`,
and `machine` when the service serves machine operations (a client accepts the word and may use none of them);
`welcome.state` is the current `Status`. A client refuses a `welcome` of another `v` the same way (`version`).

The message `type` values are `hello`, `welcome`, `refused`, `response`, `event` and the request types below.

## Requests and responses

A request is `{"id": "<1-64 printable ASCII>", "type": "<request type>", ...fields}`. Unknown fields are refused. Each
request gets exactly one `{"id", "type": "response", "ok": true, "data": {...}}` or
`{"id", "type": "response", "ok": false, "error": {"code", "reason", "action"}}`. A request type this version does
not define is answered `unknown_type`; a malformed request `invalid_request` (its `reason` names the field, never its
value). Requests are answered in any order; clients correlate by `id`.

| Request                      | Fields                                                                   | Response `data`                                                      | Notes                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `authenticate`               | `client_proof`                                                           | `{}`                                                                 | the handshake's last step                                             |
| `status.get`                 |                                                                          | `Status`                                                             |                                                                       |
| `status.subscribe`           |                                                                          | `{}`                                                                 | then `status.changed` with the current status, and after every change |
| `service.set_enabled`        | `enabled` (boolean)                                                      | `{enabled}`                                                          | off keeps the service installed but disconnected; persists            |
| `refresher.register`         | `binary_path` (absolute), `version` (semver)                             | `{}`                                                                 | the binary the service runs to refresh its access token               |
| `device.adopt`               | `device {id, name}`, `signing_private_key`, `sealing_private_key`        | `{device}`                                                           | keys below; never logged or echoed                                    |
| `device.forget`              |                                                                          | `{}`                                                                 | the service forgets the device and reports `signed_out`               |
| `device.info`                |                                                                          | `{device}` (`{id, name}` or null)                                    |                                                                       |
| `endpoints.register`         | `agent_dir` (absolute)                                                   | `{}`                                                                 |                                                                       |
| `endpoints.unregister`       | `agent_dir` (absolute)                                                   | `{}`                                                                 |                                                                       |
| `devices.list`               |                                                                          | `{devices: [{device, label, kind, platform, last_seen_ms, online}]}` |                                                                       |
| `sessions.list`              | `filter?` (`device`, `project`, `state`), `rows?` (`2`)                  | `{query_id}`                                                         | then the round and listing events                                     |
| `session.attach`             | `device`, `session_id`                                                   | `{attach}`                                                           | then the attach stream                                                |
| `session.detach`             | `attach`                                                                 | `{}`                                                                 | closing a connection detaches its attaches                            |
| `session.command`            | `attach`, `command_id?`, `rpc` or `upload_id`, `delegated?`, `endpoint?` | `{command_id}`                                                       | then `session.command_state`; delegated: see below                    |
| `session.endpoints`          | `device`                                                                 | `{endpoints}` (0-16 endpoint keys)                                   | a host that takes no delegated commands answers `unsupported`         |
| `session.locate`             | `device`, `engine_id` (1-128 characters)                                 | `{device, key, session}`                                             | the session a create over an endpoint made; `key` is what `session.attach` takes |
| `session.command_part`       | `attach`, `upload_id`, `index`, `count`, `b`                             | `{received: index}`                                                  | an upload part                                                        |
| `session.read`               | `attach`, `before_entry_id?`, `tail?` (1-200)                            | `{query_id}`                                                         | then `session.read_result`                                            |
| `enforcement.report`         | `generation`, `data_home`, `environments`, `complete`                    | `{}`                                                                 | desktop clients only, for their own `data_home`                       |
| `owner.shutdown_for_upgrade` | `target_version` (semver)                                                | `{}`                                                                 | installer clients only; the service then stops                        |
| `control.attach.get`         |                                                                          | `{attached, changedAt}`                                              | desktop and CLI clients; never set reads attached with changedAt ""   |
| `control.attach.set`         | `attached` (boolean)                                                     | `{attached, changedAt}`                                              | desktop and CLI clients; persists; detached refuses other devices     |

Keys for `device.adopt`: the standard base64 (padded) of the key's PKCS#8 DER, 48 bytes: the body of a PEM file without
its header, footer and line breaks. The signing key is Ed25519 (OID 1.3.101.112), the sealing key X25519
(OID 1.3.101.110); a key of the other algorithm, another length, or anything that is not exactly that encoding is
refused `invalid_request`. The local API checks the shape only; the service checks the keys themselves.

`environments` in `enforcement.report` is a list of `{environment_id, revoked, closed}` with unique ids and
non-negative integer counts; `complete` is true only when every environment of that home reported for `generation`.
An empty list with `complete: true` is a legitimate report.

Commands (`rpc`): one engine RPC inbound record, a JSON object whose `type` is the method (decision 0011). The local API
defines no per-operation body; the record is opaque to it apart from its size, the upload path and the `command_id`
ledger (#105).

## Status

`Status` is `{state, since_ms, detail?: {code, action}, device: {id, name} | null, origin_configured, enabled,
policy?: {state, generation, this_device, homes_pending, unacked: [{device, label}]}}`. `action` is the one thing the
user can do, or null; clients show an error notice only when there is one.

| `state`               | Meaning                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `not_configured`      | the service has no origin to connect to yet                                           |
| `disabled`            | the switch is off (`service.set_enabled`)                                             |
| `sign_in_required`    | no account on this device, or it was signed out remotely                              |
| `plan_required`       | the account's plan does not include remote sessions                                   |
| `keychain_locked`     | the account credential is behind a locked keychain                                    |
| `connecting`          | connecting, or reconnecting after a loss                                              |
| `activation_pending`  | connected, but remote sessions are not active for the account yet (`policy` says why) |
| `connected`           | connected; remote sessions available                                                  |
| `offline`             | no network path to the service's origin                                               |
| `authorization_stale` | the device list could not be refreshed before it expired; reconnecting                |
| `service_degraded`    | a local failure the user may fix (`detail.action`)                                    |
| `update_required`     | this build is too old                                                                 |
| `signed_out`          | `device.forget` ran; the service keeps running                                        |

`policy.state` is `off`, `pending` or `active`; `policy.this_device` is `unclassified`, `desktop_unregistered`,
`indeterminate`, `desktop`, `cli_only` or `acked`.

## Errors

`error.code` is one of: `unauthenticated`, `client_proof_invalid`, `invalid_request`, `unknown_type`, `forbidden`,
`owner_transfer`, `internal`, `signed_out`, `device_mismatch`, `device_changed`, `account_changed`,
`device_key_invalid`, `service_disabled`, `sign_in_required`, `plan_required`, `activation_pending`,
`authorization_stale`, `peer_not_found`, `peer_not_session_client`, `session_not_found`, `engine_too_old`,
`not_attached`, `command_id_conflict`, `message_too_long`, `upload_incomplete`, `malformed`, `method_unclassified`,
`method_local_only`, `host_not_answering`. A further code, `unsupported`, answers a request this service defines but
does not serve: every machine request while `welcome.capabilities` lacks `machine`. `message_too_long` alone carries
`limit_chars` (1,000,000). A `forbidden` answer to `refresher.register` may carry `path_refusal: {component, problem}`:
the first path component, from the root down, that the refresher path rule refused, and why (`not_absolute`,
`not_found`, `not_regular_file`, `not_executable`, `foreign_owner`, `group_writable`, `world_writable`,
`windows_acl`). No other code carries it. `reason` is a diagnostic sentence; `action` is the user's next step or null. While the
service is being replaced it answers only `status.get` and `status.subscribe` and refuses the rest `owner_transfer`.

`host_not_answering` is retryable: the host did not answer within its bound, and a client may send the same request
again after a backoff that starts at 500 ms, doubles per consecutive `host_not_answering`, and is capped at 30 s; no other
error code is retryable by this rule. The service sends it only to a client whose hello names a version at or above the first
version of that client name that knows the code; any other client gets `internal` with the same `reason`, and its
connection stays open.

A client library also raises `insecure_state_dir`, `server_proof_invalid`, `refused` (with the refusal reason),
`protocol_violation` (the service broke this contract; the connection is closed), `closed`, `read_failed` and
`handshake_timeout` (the endpoint did not complete the handshake within 10 seconds; the connection is closed) and
`request_timeout` (the owner did not answer a request within 30 seconds; the connection stays open and a late answer
is dropped). For `session.command` a timeout is `uncertain` under the evidence rule below: the command may have been
dispatched. The client library therefore always sends a `command_id` (it mints one when the caller gives none) and
reports it on the `request_timeout` error, so the caller follows `session.command_state` for that id. A retry sends
the same op and text to the same target session under the same `command_id`, which the service answers without
dispatching again (any other payload under it is `command_id_conflict`); never a new id. A timeout on an upload part
is different: `session.command` was not sent yet, so it carries no `command_id` and a fresh retry is safe.

`refused` is unauthenticated: it arrives before the owner proves the per-boot token, so any local process listening
on the endpoint can send it, with any reason. A client treats it as untrusted: it may report it and stop, but it
never takes a privileged or destructive step on it (an upgrade, a data-home change, a credential reset) without a
proven connection.

## Events

Events are `{"type": "event", "kind": "<kind>", ...}`:

| Kind                         | Fields                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status.changed`             | `status`                                                                                                               |
| `sessions.round`             | `query_id`, `state` (`open`, `done`), `devices` (device to round state)                                                |
| `sessions.listing_begin`     | `query_id`, `revision`                                                                                                 |
| `sessions.listing_rows`      | `query_id`, `revision`, `rows` (one or more)                                                                           |
| `sessions.listing_end`       | `query_id`, `revision`, `incomplete` (devices)                                                                         |
| `session.snapshot`           | `attach`, `attach_id`, `cursor {marker_id, last_entry_id}`, `state`, `entries`, `history_truncated`, `oldest_entry_id` |
| `session.snapshot_loading`   | `attach`, `blob`                                                                                                       |
| `session.records`            | `attach`, `attach_id`, `records` (one or more; dialog records included)                                                |
| `session.blob_open`          | `attach`, `id`, `of`, `bytes`, `sha256` (hex), `position`                                                              |
| `session.blob_chunk`         | `attach`, `id`, `off`, `b` (base64)                                                                                    |
| `session.blob_done`          | `attach`, `id`                                                                                                         |
| `session.blob_abort`         | `attach`, `id`, `reason`; `query_id` and `entry_id` when `reason` is `too_large`                                       |
| `session.attach_pending`     | `attach`, `reason` (`stream_key_pending`)                                                                              |
| `session.detached`           | `attach`, `reason`                                                                                                     |
| `session.command_state`      | `command_id`, `state`, `reason?`, `retryable`, `receipt?`                                                              |
| `session.read_result`        | `attach`, `query_id`, `entries`, `next_before`                                                                         |
| `session.upload_abort`       | `upload_id`, `reason`                                                                                                  |
| `session.command_event`      | `device`, and `frame`, or `command_id` and `response`, or `blob {id, bytes, sha256}`                                   |
| `session.command_blob_chunk` | `id`, `off`, `b` (base64)                                                                                              |
| `session.command_blob_done`  | `id`                                                                                                                   |
| `session.channel_closed`     | `device`, `reason`                                                                                                     |

Listing rows are `{device, session_id, title, project, path, state, updated_ms, source, as_of}`: `state` is
`running`, `idle` or `ended`; `source` is `live` or `cache`; `as_of` is when the row was observed. A `sessions.list`
with `rows: 2` (#316) gets rows that may also carry `kind`, `parent` and `parent_listed`; without it a row never
carries them. `kind` is the session kind as its host reports it (`interactive`, `worker`, or a kind the client does
not know, kept as reported); absent means unknown, not interactive. `parent` is the `session_id` of the session it
was started from, on the same `device`, and `parent_listed` says whether that row is in this listing (false: show the
link unresolved). A service before `rows` answers it `invalid_request`. `detached` reasons:
`authorization_expired`, `activation_pending`, `service_disabled`, `owner_transfer`, `peer_revoked`,
`stream_key_pending`, `peer_detached`, `blob_failed`, `session_closed`, `session_replaced`. `session_closed` and
`session_replaced` (decision 0013 amendment 2026-11-03) mean the host's engine closed the attached session, or now
serves another session behind its handle that the attachment does not follow; the event arrives as soon as the host
says so. A client whose hello version is below its name's entry receives `peer_detached` instead, at the same moment.
Blob abort reasons: `digest_mismatch`, `source_gone`,
`too_large`, `detached`. Upload abort reasons: `message_too_long`, `parts_conflict`, `malformed`, `detached`.

## Session list rounds

`sessions.list` answers `{query_id}`, then the service runs (or joins) one unfiltered round across the account's
devices and publishes the result for this query as revisions:

1. `sessions.round {state: "open", devices}` with every device `pending`.
2. Revision 1 at once: the cached rows (`source: "cache"`, with `as_of`), as `listing_begin`, zero or more
   `listing_rows`, `listing_end`.
3. A new revision each time answers arrive, each a complete listing: a client replaces its whole view at each
   `listing_end`, never row by row. `incomplete` names devices whose rows may be missing.
4. `sessions.round {state: "done", devices}` after the `listing_end` of the query's last revision. Device states:
   `answered`, `pending`, `undelivered`, `page_cap`, `cursor_echo`, `timed_out`, `skipped`.

A filter (`device`, `project` exact match, `state`) changes only this query's revisions; it never reaches other
devices and never changes another client's result. Revisions increase; rows only appear between a `listing_begin`
and its `listing_end`.

## Attach, snapshot and records

`session.attach` answers `{attach}`, a local handle owned by this connection (another connection's handle is
`not_attached`). The service holds that answer until the remote host accepts the attach (`{attach}`), refuses
it (`session_not_found`) or does not answer within its bound, the wait for the stream key included
(`host_not_answering`, with no handle and no event after it); every answer comes within the 30 s request timeout. A
held `session.attach` has no handle, so it cannot be detached: a client waits for its one answer or closes its
connection. A second `session.attach` of the same device and session while one is held gets the same answer. Then the
snapshot: `session.snapshot` inline, or `session.snapshot_loading {attach, blob}` followed by the blob of that id
(`of: "state"`). Records follow in order. When the service re-establishes the attach under a new `attach_id`, a new
snapshot arrives and replaces the old state; records always name their `attach_id`. `session.detached` ends an
attach.

## Commands

`session.command` carries one engine RPC record inline (`rpc`), or names an upload. A `command_id`, when given, is exactly 22 base64url
characters; without one the service mints one. A command_id binds once to its target session and the SHA-256 of its
payload: a repeat with the same binding answers the same `command_id` and dispatches nothing more; any other repeat
is `command_id_conflict`.

The service takes the receiver's first three steps before anything leaves the device, through the engine's method
classes (S24), and refuses by name: `malformed` (the record is not a decision 0011 record: its `type` is not a method
name, or an answer map is over the bounds), `method_unclassified` (the classes do not name the method) and
`method_local_only` (a `connection_local` method configures a local connection and never travels). Whether the
sender holds a grant for the method's class is the receiving device's decision: a missing one ends the command
`engine_refused {reason: "capability_missing"}`.

A record whose JSON is over 1,000,000 characters (the engine's limit, counted in UTF-16 code units) or 3,000,000 UTF-8
bytes is refused `message_too_long {limit_chars: 1000000}` before anything leaves the device. A client checks this
itself before sending any part.

Uploads: when the inline `session.command` line would exceed `LOCAL_INLINE_MAX`, the client sends the record's UTF-8 JSON in
`session.command_part {attach, upload_id, index, count, b}` (every part but the last exactly `LOCAL_CHUNK_MAX` raw
bytes; `count` at most 12) and then `session.command {attach, command_id?, upload_id}`; an upload that is not one JSON object is refused
`invalid_request`. The same index with other
bytes, or another `count`, aborts the upload (`session.upload_abort {reason: "parts_conflict"}`); a command naming an
upload that is not complete is refused `upload_incomplete`.

### Delegated commands (decision 0018)

A `session.command` with `delegated: true` (or with `endpoint`) runs on this connection's own delegated engine
connection on the host, named by a `conn` the service mints per connection and host device. The host's engine decides
the record (the service classifies nothing), so any engine method reaches it. `endpoint` is a key from
`session.endpoints` and sends a session-less record (`list_sessions`, `get_protocol_info`, ...) to that engine
endpoint. The service sends either only to a host whose `machine.describe` lists `session-delegated:v1`; toward any
other host a `delegated` command keeps today's shape and an `endpoint` one is refused `unsupported`.

Every delegated command's engine reply arrives as `session.command_event {device, command_id, response}` before its
terminal `session.command_state`; a plain command keeps today's events. Every frame the engine writes unasked on the
delegated connection (session events after `attach_session`, `subscribe_sessions` deltas, dialog requests) arrives as
`session.command_event {device, frame}`, in the engine's write order. A value whose line would pass the inline limit
arrives as `session.command_event {device, blob}` followed by `session.command_blob_chunk` events of its UTF-8 JSON
and `session.command_blob_done`. `session.channel_closed {device, reason}` (`event_overflow`, `event_too_large`,
`idle`, `engine_closed`, `event_lost` when the host could not repair a lost event, or `event_gap` when more than 64
events waited behind a missing one or a missing one stayed unrepaired for 30 s with no progress) ends the channel toward
that device exactly like a closed socket: the client drops what it held on it, a delegated command still in flight on it
ends `uncertain` (`request_gone`), and its next delegated command opens a fresh one. Closing the local
connection closes its delegated connections on every host.

### Command states and the evidence rule

`session.command_state` reports, in order: `queued` (not every part is acknowledged yet), `transport_confirmed`
(every part acknowledged), then the outcome on the session's device: `engine_dispatched`, `engine_applied`,
`engine_refused {reason}` (`parts_conflict`, `peer_unauthorized`, `message_too_long`, `engine_capability_missing`, the
receiver's `malformed`, `method_unclassified`, `method_local_only`, `capability_missing`, and `schema_stale`,
`tool_unknown`, `cancelled`, `hand_restarted`, `scope_unknown`, `scope_closed`, `epoch_fenced`,
`epoch_step_exceeded`), `engine_stale`, or `uncertain {reason}` (`request_gone`, `no_receipt`, `engine_restarted`,
`recipient_revoked`, `transport_expired`, `unconfirmed`, `lease_expired`, `cancelled`, `hand_restarted`,
`result_expired`, `record_too_large`). These are exactly the reasons a host can send (the vendored session contract's
lists); the service passes each through as itself.

A command is reported `not delivered: never_sent` only with evidence that no part of it was ever written to the
transport; it is the only "not delivered" state. An expiry on the transport is not that evidence (the command may
have been delivered and applied): it is `uncertain {reason: "transport_expired"}`. A part that was written but never
acknowledged when the other device lost access is `uncertain {reason: "unconfirmed"}`. `not confirmed` means the
transport refused a part, so nothing was stored. `retryable` is true exactly for `not confirmed` and
`not delivered: never_sent`; a retry is a new command with a new `command_id`. Clients offer a retry only when
`retryable` is true, never for an `uncertain` state.

## History reads

`session.read {attach, before_entry_id?, tail?}` (tail 1-200, default chosen by the service) answers `{query_id}`, then
one `session.read_result {attach, query_id, entries, next_before}`. Each entry is `{kind: "entry", entry_id, entry}`
or `{kind: "entry_ref", entry_id, bytes, sha256}`. After the `read_result`, every `entry_ref`, in order, is followed by
either its blob (`of: "entry"`, `position {query_id, entry_id}`, with the ref's `bytes` and `sha256`) or
`session.blob_abort {reason: "too_large", query_id, entry_id}` for an entry too large to fetch. That abort needs no
blob to be open, does not end a blob in flight, and does not end the attach: the read resolves with the entry marked
too large. `next_before` is the `before_entry_id` of the next older page, or null at the oldest entry.

## Chunking and paging

Blobs carry a snapshot (`of: "state"`, `position {attach_id}`), one record (`of: "record"`,
`position {attach_id, seq}`) or one history entry (`of: "entry"`, `position {query_id, entry_id}`) whose line would
not fit `LOCAL_INLINE_MAX`. The blob's bytes are the UTF-8 JSON of exactly that value: the snapshot's
`{attach_id, cursor, state, entries, history_truncated, oldest_entry_id}`, the record object, or the entry. One blob
is in flight per attach; chunks come in order with `off` equal to the bytes already sent, every chunk but the last
exactly `LOCAL_CHUNK_MAX = 262,144` raw bytes; `blob_done` closes it and the client checks `bytes` and `sha256`
before applying it at its `position` (a snapshot blob is applied as a `session.snapshot`, a record blob as a
`session.records` of that one record). A blob is at most `LOCAL_BLOB_MAX = 100,663,296` bytes: a value crosses the
transport as canonical CBOR of at most 16,777,216 bytes, and no CBOR byte becomes more than 6 bytes of JSON (a
control character becomes `\u00XX`).

Arithmetic:

- A full chunk is `4 x ceil(262,144 / 3) = 349,528` base64 characters.
- The largest `session.blob_chunk` line (64-character `attach` and `id`, a nine-digit `off`) is 349,744 bytes; the
  largest `session.command_part` line (64-character `id`, `attach`, `upload_id`, index 11 of 12) is 349,816 bytes. Both
  are under `LOCAL_INLINE_MAX` and `LOCAL_LINE_MAX` (LA19).
- An upload holds at most `ceil(3,000,000 / 262,144) = 12` parts; a record of 2,097,152 JSON bytes is 8 parts.
- A 1,000-row listing at the session-list field bounds is 1,535,973 bytes as one line, over `LOCAL_LINE_MAX`; paged,
  it is 3 `listing_rows` lines of at most 523,857 bytes (LA20). A page grows by one row's JSON plus a comma, so its
  line length is known before it is written.

## Upgrade

An installer connects as `installer`, completes the proof, and sends `owner.shutdown_for_upgrade {target_version}`
(any other client is refused `forbidden`). The service answers `{}`, stops taking requests (`owner_transfer`), detaches
every attach (`session.detached {reason: "owner_transfer"}`), closes its listener and clients, closes its transport
connections and waits for them to close, then exits. The installer replaces the program, starts it, connects with the
proof again and requires `welcome.service_version` to be the target version.

## Conformance

`packages/local-api/test/conformance/` holds one JSON fixture file per request type (and `hello`), each with at least
one accepted case and one refusal, a reference server (`FakeOwner`) and the runner. A case describes a world (status,
devices, listing revisions, sessions with their snapshot, records, history pages and command outcomes), a handshake
mode (`full`, `welcome_only`, `none`) and steps: `send` a message, `expect` the next message (optionally skipping event
kinds), or `expect_closed`. In a sent message `<nonce>`, `<client_proof>`, `<wrong_proof>`, `<signing_key>`,
`<sealing_key>` and `<ref:name>` are filled in; in an expected message `<any>`, `<capture:name>`, `<ref:name>` and
`<server_proof>` match. Every message the server writes must pass the strict validators before it is matched.

Another server implementation runs the same suite from its own test file:

```ts
import { runConformance } from "<path to packages/local-api>/test/conformance/runner.ts";

runConformance({ name: "service", start: async (world) => startServiceFor(world) });
```

where `start` puts the server into the world's state and returns `{stateDir, token, stop}`.
