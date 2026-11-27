import { userInfo } from "node:os"
import type { RemoteClient } from "../client"
import {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "../factories"
import type { RemoteSender } from "../types"
import { remoteSessionsPort } from "./sessions-port"

// What the thread tools take from the remote module (through its index): the thread tools' port over this device's
// device service is built here, in L2, so no thread file opens a device-service connection itself (guard G1, design
// v8-core r2), and the client a sender names.

export { remoteSessionsPort }

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
