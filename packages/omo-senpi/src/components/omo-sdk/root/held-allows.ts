import type { PrincipalKind, RootCallKey } from "../contract"

/**
 * The (call, principal) pairs the boundary refuses with the default refusal although no refusal cell names them: an allow
 * on a condition no test meets yet (LEAD ruling as security owner: a conditional allow is not a live allow), or a cell the
 * security design marks n/a. Closed and self-retiring: an entry whose cell becomes a plain allow or a refusal fails the
 * default-deny test as stale. Each names the condition and the slice that meets it.
 */
export type HeldAllow = {
  readonly call: RootCallKey
  readonly principal: PrincipalKind
  readonly condition: string
  readonly owner: string
}

const NON_DISCLOSURE =
  "the non-disclosure test run for a session shows the output holds no credential (security design 4.2)"

const CONFIG_FILES = "its output is shown to carry nothing from the files it reads (security design 4.3)"

export const HELD_ALLOWS: readonly HeldAllow[] = [
  { call: "account.show", principal: "session", condition: NON_DISCLOSURE, owner: "A1b" },
  { call: "account.signInCheck", principal: "session", condition: NON_DISCLOSURE, owner: "A1b" },
  { call: "config.status", principal: "session", condition: CONFIG_FILES, owner: "C1b" },
  { call: "config.status", principal: "service", condition: CONFIG_FILES, owner: "C1b" },
]
