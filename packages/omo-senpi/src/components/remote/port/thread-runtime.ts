import { userInfo } from "node:os"
import { createServiceAliasRegistry, type ServiceAccess } from "../../thread/remote/alias-registry"
import type { RemoteSessionsPort, RemoteThreadSurface } from "../../thread/remote/ports"
import type { RemoteClient } from "../client"
import { connectionOf, dialOf } from "../connection-of"
import {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "../factories"
import type { RemoteSender } from "../types"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"

// What the thread client sidecar (`#omo-thread-client-runtime`, live-surface.ts) takes from the remote module: the thread
// tools' port over this device's device service is built here, in L2, so no thread file opens a device-service
// connection itself (guard G1, design v8-core r2).

// The port borrows the client's shared connection (#13768 L3): one connection per engine, closed by the client.
export const remoteSessionsPort = (version: string, client: RemoteClient): RemoteSessionsPort =>
  createDeviceServiceSessions({
    version,
    connect: async () => ({ conn: await connectionOf(client), owned: false }),
    dialEndpoint: async () => ({ conn: await dialOf(client), owned: true }),
  })

// Built through its sender's factory, as every client is (remote/index.ts).
export function remoteClient(version: string, sender: RemoteSender): RemoteClient {
  switch (sender.kind) {
    case "session":
      return remoteClientForSession(sender.id, { version })
    case "cli":
      return remoteClientForCli(sender.uid, { version })
    case "person":
      // A person client acts as the OS user running this process; any other uid is refused, never silently replaced.
      if (sender.uid !== String(userInfo().uid)) throw new Error("A person client is built for the user running omo.")
      return remoteClientForPerson({ version })
    case "connector":
      return remoteClientForConnector(sender.binding, { version })
    case "service":
      return remoteClientForService({ version })
  }
}

/**
 * The remote surface the `omo thread` CLI hands its SDK (#12833), from this sidecar's own device-service and alias clients;
 * `loadAccess` is the CLI sign-in (the device-account sidecar's `cliServiceAccess`), loaded only when an alias is used.
 * The caller closes it with `sessions.close` before it exits.
 */
export function createCliRemoteSurface(options: {
  readonly version: string
  readonly loadAccess: () => Promise<ServiceAccess>
}): RemoteThreadSurface {
  return createLazyRemoteSurface({
    version: options.version,
    // The `omo thread` CLI's principal is `cli:<uid>` (sdk.ts), the uid omo-native's thread.js names.
    sender: { kind: "cli", uid: String(process.getuid?.() ?? 0) },
    loadRuntime: async () => ({ remoteSessionsPort, remoteClient }),
    loadAliasRegistry: async () => createServiceAliasRegistry(await options.loadAccess()),
  })
}
