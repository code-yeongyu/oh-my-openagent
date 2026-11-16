import { type ClientCore, notYet, type RemoteClient } from "./client"

type SessionMembers = Pick<
  RemoteClient["sessions"],
  "get" | "open" | "send" | "read" | "interrupt" | "setModel" | "setReasoning" | "close" | "archive"
>

/**
 * The session members of part 4a-2 (unit U1 of #13414): get, open (the shared create path), send, read, interrupt,
 * setModel / setReasoning (session scope only), close and archive. Each answers `unsupported` until U1 lands.
 */
export function sessionMembers(_core: ClientCore): SessionMembers {
  return {
    get: async () => notYet("sessions.get"),
    open: async () => notYet("sessions.open"),
    send: async () => notYet("sessions.send"),
    read: async () => notYet("sessions.read"),
    interrupt: async () => notYet("sessions.interrupt"),
    setModel: async () => notYet("sessions.setModel"),
    setReasoning: async () => notYet("sessions.setReasoning"),
    close: async () => notYet("sessions.close"),
    archive: async () => notYet("sessions.archive"),
  }
}
