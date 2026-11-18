// The remote module's public surface (#13414, design B2): its factories, its types, its codes and their exit codes.
// createRemoteClient stays internal: every caller builds its client through its sender's factory.
export type { RemoteClient } from "./client"
export type { LocalSessions } from "./local-sessions"
export { exitCodeOf, REMOTE_CODES, type RemoteCode } from "./codes"
export {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "./factories"
// Seam 1 (the only thread-address parser) and seam 2 (the only thread-naming helper): surfaces parse and name threads here.
export { canonicalizeThreadHandle, type CanonicalThread, describeThread, handleOf } from "./seams"
// Seam 3 (the only device resolver for a typed device): thread_create's resolveDevice over the account's devices.
export { resolveTypedDevice } from "./device-address"
export type * from "./types"
