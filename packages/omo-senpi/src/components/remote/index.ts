// The remote module's public surface (#13414): the client, its factories, its types, its codes and their exit codes.
export { createRemoteClient, type RemoteClient } from "./client"
export { exitCodeOf, REMOTE_CODES, type RemoteCode } from "./codes"
export {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForSession,
} from "./factories"
export type * from "./types"
