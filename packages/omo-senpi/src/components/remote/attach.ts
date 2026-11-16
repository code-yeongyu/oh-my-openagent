import { type ClientCore, notYet, type RemoteClient } from "./client"

/** `attach` of part 4a-2 (unit U2 of #13414): snapshot, records, pending UI requests and answers. Stub until U2 lands. */
export function attachMember(_core: ClientCore): RemoteClient["attach"] {
  return async () => notYet("attach")
}
