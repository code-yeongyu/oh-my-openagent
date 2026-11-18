# @sisyphuslabs/bunshin-ts-relay

`createRelayTransport()` is a bunshin-ts `MachineHubTransport` that runs machine operations through this device's own
device service over the local API, instead of the bunshin hub.

```ts
import { connect } from "@sisyphuslabs/bunshin-ts";
import { createRelayTransport, relayStatus } from "@sisyphuslabs/bunshin-ts-relay";

if ((await relayStatus()).connected) {
  const fleet = await connect({ transport: createRelayTransport() });
  console.log((await fleet.listMachines()).map((machine) => machine.alias));
  await fleet.close();
}
```

## Reaching the device service

The state dir is `OMO_DEVICE_SERVICE_STATE_DIR`, else `~/.omo/device-service` (`%LOCALAPPDATA%\OmO\device-service` on
Windows). `PI_SESSION_ID`, when set, is sent with each batch as attribution only.

`relayStatus({ stateDir? })` connects once and returns `{ state, device, connected }`. When no service is listening it
returns `connected: false` with `state` and `device` null; a service that fails its proof or an insecure state dir
still throws. `state` is the service's status (for example `connected`, `sign_in_required`, `offline`).

`createRelayTransport(options)` takes `stateDir`, `sessionRef` (1-128 characters; defaults to `PI_SESSION_ID`),
`requestTimeoutMs` (default 30,000), `describeTimeoutMs` (default 10,000), `clientName` (default `sdk`),
`clientVersion` and `reportError` (receives an exception thrown by an `events()` subscriber; by default it is rethrown
on its own microtask).

`clientName` identifies a local API role, not an application label. This transport accepts only `sdk`, its default.
Other values, including the privileged `omo` and `installer` roles, `desktop` and application names such as
`duty-probe`, throw `RelayTransportError` with code `invalid_client_name` when the transport is created,
before any connection is opened. The error names `sdk` as the only supported role.

## Machines and operations

`listMachines()` lists the account's other devices, then this device. Each device's describe settles on its own: a
device that does not describe itself within `describeTimeoutMs`, or whose describe the service refuses, is reported
unsupported with `attention` naming why and after how long (`unreachable after <ms> ms: <reason>`), and the others list
as described; only a failure of the connection itself fails the listing. This device is listed unsupported, since the
service runs no machine operation on its own device, so fanout skips it. `listTools()` answers `[]` at once for a device
the latest listing could not describe or reported unsupported, without describing it again. `listTools(machineId)` returns the operations that device advertises; this package fixes no
operation list.

`invoke`'s `terminalTimeoutMs` is a duration. The transport sends it as the op's `deadline_ms`, the absolute epoch-ms
time `Date.now() + terminalTimeoutMs` the local API requires; the target device then ends the op `timed_out` at that
time.

A whole `fs.read` (no `offset`, no `limit_bytes`) that the device fails `limit_exceeded` is read again in chunks
of the device's `read_max_bytes` (#1124), and `invoke` answers the whole file:

- The file is `fs.stat`ed before the first chunk and after the last. A size or `mtimeMs` that differs, or a chunk
  that names another size or ends early, fails `file_changed`. The device answers no inode, so a rewrite of the same
  size inside the same millisecond is the one change this cannot see.
- A file above `CHUNKED_READ_MAX_BYTES` (256 MiB) is refused `limit_exceeded` before any chunk is read, naming the cap
  and `fs.read {path, offset, limit_bytes}`: the chunks are held and joined here (about 3.3x the file in memory), and
  the target device keeps each chunk's result for 600 s.
- A device that refuses `fs.stat` for the file is not read in chunks, and the whole read's `limit_exceeded` reaches
  the caller. A refusal is `op_unknown` (the device has no `fs.stat`) or a `capability_*` or `constraint_*` code (the
  token or grant does not allow it). Any other failure of that stat reaches the caller as itself: a passed deadline
  stays `timed_out`, an abort rejects with `AbortError`, and a closed connection rejects with `RelayTransportError`.
- A chunk reply without base64 `bytes` and a numeric `size`, at another offset than the one asked for, longer than
  `read_max_bytes`, or running past the file's size fails `protocol_violation`, and nothing from it is joined.
- The caller's op id names the whole read: `resultOf(that id)` answers its `failed limit_exceeded`. The chunks run
  under fresh ids, so a caller that lost the answer reads again.

An `fs.write` too large for one inline batch (base64 above 480 KiB) is written as one `fs.write` and then
`fs.write_range` pieces of 256 KiB (`WRITE_CHUNK_BYTES`), so a large write works on every service version (one
`fs.write` is refused above 3,840,000 base64 bytes, and a 0.1.33 service takes no batch above 512 KiB, #1250). This
happens only when the device advertises `fs.write_range`, the write has exactly the device's shape (`path`, canonical
base64 `bytes`, an optional boolean `create_parent_dirs`) and the caller's capability token, if any, allows both
`fs.write` and `fs.write_range`; otherwise the write goes as one `fs.write`, as before. When the device advertises
`shell` and the token allows it, the device's sha256 of the file must then equal the bytes sent, or the write fails
`verify_failed`. The answer is one write's `{path, bytesWritten}` with the device's resolved path. A piece that fails
after the first keeps the device's error code and says the write is incomplete: the file then holds the new bytes up
to that piece, and the rest is missing or zero-filled (no old byte survives). The pieces run under fresh op ids, so
`resultOf` does not answer for the caller's op id.

bunshin-ts's `pushTree` and `pullTree` run over the relay, although the device service serves no tree op: the
transport composes `fs.tree.apply` and `fs.tree.pack` from ops a device does serve, and lists them for a device that
advertises `fs.write`, `fs.write_range` and `shell` (apply) or `fs.list`, `fs.stat`, `fs.read` and `shell` (pack), is
not Windows, and does not serve the op itself:

- `uploadArtifact(bytes)` holds pushTree's archive in this process and answers a ref on
  `https://relay-artifact.invalid/` (a reserved host that never resolves); `fetchArtifact` serves pullTree's download
  of such a ref and passes any other URL to `fetch`. Each archive is held under its own URL key (two identical trees
  moving at once never share one) until it is used once, and all are dropped at `close()`.
- Apply refuses an archive member with an absolute or `..` path, a symlink whose target leaves the tree, a path listed
  twice or a member under a symlink member, before any op runs. A symlink already in the destination is removed when a
  member takes its path (or a listed directory replaces it), and refused `path_escape` when it is a parent directory
  the archive does not list, so no write follows it out of the tree. Each file is one `fs.write` with
  `create_parent_dirs`, continued in `fs.write_range` pieces of 256 KiB (`WRITE_CHUNK_BYTES`), so every op's batch
  fits the local API's 512 KiB inline limit on every service version.
  Directories (empty ones included), modes and then symlinks are set in `sh` steps, and `clean` empties the destination
  first (an absolute path at least two levels deep, as bunshin's extractor requires).
- Pack walks the tree with `fs.list`, keeps what bunshin's packTree keeps (its default excludes and the `include` /
  `ignore` globs), takes each file's and directory's mode from `fs.stat`, reads each file whole (in chunks above
  `read_max_bytes`, as above), reads symlinks with `readlink` (a failed one fails the op) and drops one whose target
  leaves the tree.
- Both verify every file: the device's `sha256sum` (or `shasum -a 256`) of each file must equal the bytes moved, or the
  op fails `verify_failed`. At most four files or directories move at a time, and none starts after one has failed.
- A composed op runs as several device ops under fresh op ids, so `resultOf` does not answer for the caller's op id.

The target device runs an op only while it is attached and this device is in its account's roster; its user can
refuse this device there with `omo-device-service control machine <device> deny` (allowed by default), and the op
then fails with `capability_missing`.

Beyond `MachineHubTransport`, the transport (`kind: "relay"`) has:

- `resultOf(requestId)`: the op's result, or `in-flight`.
- `events(options)`: the fleet event source.
- `output(handle)`: a handle's output in order, as `{ kind: "bytes", bytes }` items with `{ kind: "gap", missing }`
  markers; each 64 KiB read grants the next 64 KiB (`OUTPUT_CREDIT_BYTES`).
- `getPolicy(machineId)` and `setPolicy(machineId, policy)`: the target device's `policy.get` and `policy.set` ops.
- `mintCapabilityToken(input)`: no hub signs the token; it is its claims. Known gap (#380): the transport sends every
  claim, `machineId` and `nbf` included, as the op's `constraints`, and the device accepts only `allowedOps`,
  `pathJail` and `exp` there, so an op sent with a minted token is currently refused `malformed`.
- `relayStatus()`: the status of the open connection.

## Errors

- `RelayTransportError`, by `code`: `invalid_client_name` (the client role is unsupported),
  `not_connected` (no service is listening, or `connect()` was not called),
  `server_proof_invalid`, `insecure_state_dir`, `refused`, `request_timeout`, `closed`, `unsupported` (the service
  does not serve machine operations) and `result_expired` (`resultOf` for an op the service holds no result for). A
  `request_timeout` on an invoke means the op may have run; its `requestId` names the op for `resultOf`.
- `MachineWireError`: an op's own refusal or failure, with the target device's code (for example
  `capability_missing` or `host_detached`, or `deadline_not_absolute` for a `deadline_ms` that reads as a duration).
- `CapabilityUnavailableError`: the target device has no such operation.
- `CapabilityTokenMintError`: `mintCapabilityToken` got malformed input.

Proprietary: see LICENSE.
