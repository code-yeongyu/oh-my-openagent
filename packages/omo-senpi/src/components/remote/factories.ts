import { userInfo } from "node:os"
import { createOmoNativeProductConfig } from "../telemetry/product-identity"
import { createRemoteClient, type RemoteClient, type RemoteClientDeps } from "./client"
import type { RemoteSender } from "./types"

/** A factory's deps: the client's own, with the version defaulting to this omo-senpi build's package version. */
type RemoteClientFactoryDeps = Omit<RemoteClientDeps, "version"> & { readonly version?: string }

const build = (sender: RemoteSender, deps: RemoteClientFactoryDeps = {}): RemoteClient =>
  createRemoteClient(sender, { ...deps, version: deps.version ?? createOmoNativeProductConfig().packageVersion })

/** The person at this device: the OS user running the process. */
export const remoteClientForPerson = (deps?: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "person", uid: String(userInfo().uid) }, deps)

/** A session acting through the thread tools, by its durable id. */
export const remoteClientForSession = (sessionId: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "session", id: sessionId }, deps)

/** A chat connector, by its relay binding. */
export const remoteClientForConnector = (binding: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "connector", binding }, deps)

/** The `omo remote` CLI, run by the OS user `uid`. */
export const remoteClientForCli = (uid: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "cli", uid }, deps)
