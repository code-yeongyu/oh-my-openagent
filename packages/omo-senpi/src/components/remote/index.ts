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
export { resolveTypedDevice } from "../thread/address"
// Seam 4 (the only resolver for a typed thread address, #14305): every `omo remote` verb resolves what a person typed here.
export { resolveTypedAddress } from "./device-address"
// Seam 5 (#13414 4c-2): the person client's thread surface that resolver reads, and the relay check every verb answers first.
export { personSurface } from "./person-surface"
export { relayUnavailable } from "./relay-availability"
export type * from "./types"
// What `omo remote`'s local-only path reads beside the client: the account state, this device's state dir and endpoint,
// the session-row states, and the local API's connection and errors. All local-only (remote-local-reachability.test.ts).
export {
  type AccountShowResult,
  accountStateNotice,
  classifyAccountShow,
} from "../../../../device-service-core/src/account-state"
export {
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  LocalApiError,
  SESSION_ROW_STATES,
  type SessionFilter,
  type SessionRowState,
} from "@oh-my-opencode/device-service-core/device-service"
export { connectLocalService } from "./local-service"
// The device-service wire types a surface names in its own signatures (a command's result, an attach, the connection), so
// a surface takes them from here, not from device-service-core (guard S3).
export type { CommandResult, DeviceService, RemoteAttach } from "@oh-my-opencode/device-service-core/device-service"
export type {
  CommandStateEvent,
  JsonObject,
  RemoteAttachEvent,
  SnapshotBody,
} from "@oh-my-opencode/device-service-core"
// The thread client sidecar's port and client (#omo-thread-client-runtime, live-surface.ts).
export { remoteClient, remoteSessionsPort } from "./port/thread-runtime"
