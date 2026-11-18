import { userInfo } from "node:os"
import { createRemoteClient, type RemoteClient, type RemoteClientDeps } from "./client"
import type { RemoteSender } from "./types"

/**
 * A factory's deps are the client's own. The caller names its client version (the `version` the device service sees in the
 * hello): reading a default here would pull the product-config graph into every consumer of the module.
 */
type RemoteClientFactoryDeps = RemoteClientDeps

const build = (sender: RemoteSender, deps: RemoteClientFactoryDeps): RemoteClient => createRemoteClient(sender, deps)

/** The person at this device: the OS user running the process. */
export const remoteClientForPerson = (deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "person", uid: String(userInfo().uid) }, deps)

/** A session acting through the thread tools, by its durable id. */
export const remoteClientForSession = (sessionId: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "session", id: sessionId }, deps)

/** A chat connector, by its relay binding. */
export const remoteClientForConnector = (binding: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "connector", binding }, deps)

/**
 * The thread SDK's own principal (`createThreadSdk`), run by the OS user `uid`. `omo remote` is a person, not this: it
 * uses remoteClientForPerson.
 */
export const remoteClientForCli = (uid: string, deps: RemoteClientFactoryDeps): RemoteClient =>
  build({ kind: "cli", uid }, deps)

/** The device service's own bootstrap entry (design B4): it may run service.bootstrap, never a person's mutators. */
export const remoteClientForService = (deps: RemoteClientFactoryDeps): RemoteClient => build({ kind: "service" }, deps)
