import type { PrincipalKind, RootCallKey } from "../contract"

/**
 * The (call, principal) pairs the boundary refuses although no refusal cell names them: the four the LEAD ruled on as
 * security owner (a conditional allow is not a live allow), each a read whose answer could carry an account detail or a
 * configuration file's content before the slice that meets its condition. It is not every conditional allow or n/a cell:
 * the boundary still admits the others, and their cores answer them. Closed and self-retiring: an entry whose cell becomes a plain allow or a refusal fails the
 * default-deny test as stale. Each names the condition and the slice that meets it.
 */
export type HeldAllow = {
  readonly call: RootCallKey
  readonly principal: PrincipalKind
  readonly condition: string
  readonly owner: string
  /** What the boundary answers for the pair (code sender_not_allowed, details.reason "held"): its own text, never the default. */
  readonly message: string
  readonly next_action: string
}

const NON_DISCLOSURE =
  "the non-disclosure test run for a session shows the output holds no credential (security design 4.2)"

const CONFIG_FILES = "its output is shown to carry nothing from the files it reads (security design 4.3)"

const ACCOUNT_READ = (call: RootCallKey) =>
  ({
    message: `${call} is not served to a session until the non-disclosure run for a session shows its output holds no credential.`,
    next_action: "Ask the person on this device for the account details; a session cannot read them yet.",
  }) as const
const CONFIG_READ = (principal: "session" | "service") =>
  ({
    message: `config.status is not served to a ${principal} until its output is shown to carry nothing from the files it reads.`,
    next_action: `Ask the person on this device for the configuration status; a ${principal} cannot read it yet.`,
  }) as const

export const HELD_ALLOWS: readonly HeldAllow[] = [
  {
    call: "account.show",
    principal: "session",
    condition: NON_DISCLOSURE,
    owner: "A1b",
    ...ACCOUNT_READ("account.show"),
  },
  {
    call: "account.signInCheck",
    principal: "session",
    condition: NON_DISCLOSURE,
    owner: "A1b",
    ...ACCOUNT_READ("account.signInCheck"),
  },
  { call: "config.status", principal: "session", condition: CONFIG_FILES, owner: "C1b", ...CONFIG_READ("session") },
  { call: "config.status", principal: "service", condition: CONFIG_FILES, owner: "C1b", ...CONFIG_READ("service") },
]
