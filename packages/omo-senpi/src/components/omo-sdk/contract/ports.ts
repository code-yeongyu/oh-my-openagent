// The ports of first-party design 4.6, each replaced by a fake in the conformance test. `remote` is the thread SDK's
// cross-device port and `engine` the engine's exported functions (slice E1a), which the root reaches the same way.
export const PORTS = [
  "host",
  "store",
  "remote",
  "deviceService",
  "session",
  "credentialStore",
  "terminal",
  "process",
  "fs",
  "clock",
  "engine",
] as const

export type Port = (typeof PORTS)[number]
