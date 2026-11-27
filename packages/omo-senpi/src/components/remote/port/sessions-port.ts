import type { RemoteSessionsPort } from "../../thread/remote/ports"
import type { RemoteClient } from "../client"
import { connectionOf, dialOf } from "../connection-of"
import { createDeviceServiceSessions } from "./device-service"

// The sessions port over a remote client, apart from the thread client sidecar (thread-runtime.ts) so a caller that
// needs only the port (the person surface the CLI resolves through) does not load the sidecar's alias registry and its
// network client (remote-local-reachability.test.ts).
// The port borrows the client's shared connection (#13768 L3): one connection per engine, closed by the client.
export const remoteSessionsPort = (version: string, client: RemoteClient): RemoteSessionsPort =>
  createDeviceServiceSessions({
    version,
    connect: async () => ({ conn: await connectionOf(client), owned: false }),
    dialEndpoint: async () => ({ conn: await dialOf(client), owned: true }),
  })
