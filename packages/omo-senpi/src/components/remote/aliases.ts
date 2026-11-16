import { type ClientCore, notYet, type RemoteClient } from "./client"

/** The alias members (unit U3 of #13414, design 4b): resolve, set and clear on the account's alias registry. Stubs until U3 lands. */
export function aliasMembers(_core: ClientCore): RemoteClient["aliases"] {
  return {
    resolve: async () => notYet("aliases"),
    set: async () => notYet("aliases"),
    clear: async () => notYet("aliases"),
  }
}
