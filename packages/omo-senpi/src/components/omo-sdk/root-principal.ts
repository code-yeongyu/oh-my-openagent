import { userInfo } from "node:os"

import { isPrincipal, type OmoPrincipal } from "./contract/principal"
import type { OmoSdkOptions } from "./options"

export const processUid = (): number => process.getuid?.() ?? userInfo().uid

/**
 * The one principal a root is built for (security design section 3): the given one, else the script at this process's
 * uid. Anything that is not one of the five principals is refused here, when the root is built, so the matrix only ever
 * sees a kind it has a cell for (review of #14983 at 699c480398, MEDIUM 1).
 */
export function rootPrincipal(options: Pick<OmoSdkOptions, "principal" | "uid">): OmoPrincipal {
  const principal: unknown = options.principal ?? { kind: "script", uid: options.uid ?? processUid() }
  if (isPrincipal(principal)) return principal
  throw new TypeError(
    "createOmoSdk: the principal is not one of the five of the security design (section 3); a root is built for exactly one",
  )
}
