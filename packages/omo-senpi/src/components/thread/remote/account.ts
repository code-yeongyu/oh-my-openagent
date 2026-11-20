// Compatibility re-exports for files that import these from here (tools.ts, internals.ts, cross-device.ts, remote-ops.ts,
// address-book.ts, this-device.ts); the thread address module owns them (#14305). Unit U7 points those imports at it.
export { accountDevices, accountState, onAccount, type AccountDevices } from "../address"
