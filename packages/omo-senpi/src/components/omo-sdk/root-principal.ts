import { userInfo } from "node:os"

import { type OmoPrincipal, PRINCIPAL_ID, type PrincipalKind } from "./contract/principal"

export const processUid = (): number => process.getuid?.() ?? userInfo().uid

const isKind = (kind: unknown): kind is PrincipalKind => typeof kind === "string" && Object.hasOwn(PRINCIPAL_ID, kind)

const isId = (field: string, id: unknown): boolean =>
  field === "uid" ? typeof id === "number" && Number.isInteger(id) && id >= 0 : typeof id === "string" && id !== ""

// One of the five principals of the security design's section 3: its kind, and exactly that kind's identifying field.
// Checked against PRINCIPAL_ID rather than with the schema validator, so the root's construction and the thread SDK
// runtime stay free of the validator (P1b size ruling); principals.test.ts holds it to the Principal schema.
function isRootPrincipal(value: unknown): value is OmoPrincipal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const fields = new Map(Object.entries(value))
  const kind = fields.get("kind")
  if (!isKind(kind)) return false
  const idField = PRINCIPAL_ID[kind]
  if (idField === undefined) return fields.size === 1
  return fields.size === 2 && isId(idField, fields.get(idField))
}

/**
 * The one principal a root is built for (security design section 3): the given one, else the script at this process's
 * uid. Anything that is not one of the five principals is refused here, when the root is built, so the matrix only ever
 * sees a kind it has a cell for (review of #14983 at 699c480398, MEDIUM 1).
 */
export function rootPrincipal(options: { readonly principal?: OmoPrincipal; readonly uid?: number }): OmoPrincipal {
  // Only an absent principal takes the default; a null one is not a principal and is refused like any other value.
  const given: unknown = options.principal
  const principal = given === undefined ? { kind: "script", uid: options.uid ?? processUid() } : given
  if (isRootPrincipal(principal)) return principal
  throw new TypeError(
    "createOmoSdk: the principal is not one of the five of the security design (section 3); a root is built for exactly one",
  )
}
