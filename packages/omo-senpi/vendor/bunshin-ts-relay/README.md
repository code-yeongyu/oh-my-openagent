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

## Machines and operations

`listMachines()` lists the account's other devices, then this device. Each device's describe settles on its own: a
device that does not describe itself within `describeTimeoutMs`, or whose describe the service refuses, is reported
unsupported with `attention` naming why and after how long (`unreachable after <ms> ms: <reason>`), and the others list
as described; only a failure of the connection itself fails the listing. This device is listed unsupported, since the
service runs no machine operation on its own device, so fanout skips it. `listTools()` answers `[]` at once for a device
the latest listing could not describe or reported unsupported, without describing it again. `listTools(machineId)` returns the operations that device advertises; this package fixes no
operation list.

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

- `RelayTransportError`, by `code`: `not_connected` (no service is listening, or `connect()` was not called),
  `server_proof_invalid`, `insecure_state_dir`, `refused`, `request_timeout`, `closed`, `unsupported` (the service
  does not serve machine operations) and `result_expired` (`resultOf` for an op the service holds no result for). A
  `request_timeout` on an invoke means the op may have run; its `requestId` names the op for `resultOf`.
- `MachineWireError`: an op's own refusal or failure, with the target device's code (for example
  `capability_missing` or `host_detached`).
- `CapabilityUnavailableError`: the target device has no such operation.
- `CapabilityTokenMintError`: `mintCapabilityToken` got malformed input.

Proprietary: see LICENSE.
