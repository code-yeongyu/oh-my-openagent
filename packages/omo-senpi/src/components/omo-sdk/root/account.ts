import type { StorePort } from "@oh-my-opencode/account-core/calls/store"
import type { CustodyCapability, CustodyLog, CustodyPrincipal } from "@oh-my-opencode/account-core/calls/custody-log"
import type { AccountAccess } from "../access"
import { type OmoResult, refused } from "../result"
import type { OmoPrincipal, RootCallKey } from "../contract"
import type { MemberOf, NamespaceServing } from "./members"

// The account calls of first-party design 6.4 that slice A1b serves on the root, each over its one body in the account
// core. Every call answers desktop_sign_in under a desktop launch first (security design 4.2); the principal refusals of
// 4.2 are answered at the root boundary before a call runs (authority.ts). The call bodies (account-members.ts) and the
// custody log load on the first call that needs them, so neither sits on the SDK runtime's static import path (the P1b
// cold-import decision, #14950): a call the boundary refuses writes its one record and never loads the bodies.

// The root calls that bear custody (security design 8.2), each with the capability its records name.
const CUSTODY_CALLS: Partial<Record<RootCallKey, CustodyCapability>> = {
  "account.signIn": "account.signIn",
  "account.signOut": "account.signOut",
  "account.forget": "account.forget",
  "account.store.enable": "account.store.enable",
  "account.store.disable": "account.store.disable",
}

const ACCOUNT_CALLS = [
  "account.signInCheck",
  "account.signOut",
  "account.forget",
  "account.show",
  "account.store.status",
  "account.store.enable",
  "account.store.disable",
] as const satisfies readonly RootCallKey[]

function principalId(principal: OmoPrincipal): string {
  switch (principal.kind) {
    case "person":
    case "script":
      return String(principal.uid)
    case "session":
      return principal.session_id
    case "connector":
      return principal.binding
    case "service":
      return "service"
  }
}

const loadCustodyLog = async (principal: CustodyPrincipal): Promise<CustodyLog> => {
  const [{ custodyLog }, { accountHome }] = await Promise.all([
    import("@oh-my-opencode/account-core/calls/custody-log"),
    import("@oh-my-opencode/account-core/credential-lock"),
  ])
  return custodyLog({ home: accountHome(), principal })
}

/**
 * This root's custody log: the account home's own, its principal the root's; the log itself loads on its first record.
 * A load that fails writes no record and says so (the call answers with its audit-unavailable note, a boundary refusal
 * still answers), and is not kept: the next record loads again. `load` is the real loader unless a test passes its own.
 */
export function rootCustodyLog(principal: OmoPrincipal, load = loadCustodyLog): CustodyLog {
  let log: Promise<CustodyLog> | undefined
  const loaded = () =>
    (log ??= load({ kind: principal.kind, id: principalId(principal) }).catch((error: unknown) => {
      log = undefined
      throw error
    }))
  return {
    begin: async (capability) => {
      const ready = await loaded().catch(() => undefined)
      return ready === undefined ? NO_LOG.begin(capability) : ready.begin(capability)
    },
    refused: async (capability, code) => {
      const ready = await loaded().catch(() => undefined)
      return ready === undefined ? false : ready.refused(capability, code)
    },
  }
}

export const NO_LOG: CustodyLog = {
  begin: async () => ({ recorded: false, end: async () => false }),
  refused: async () => false,
}

/** The desktop-launch refusal of every account call, recorded for a custody-bearing one. */
export async function launchBlocked(
  access: AccountAccess,
  custody: CustodyLog,
  capability?: CustodyCapability,
): Promise<OmoResult<never> | undefined> {
  const blocked = access.blockedReason()
  if (blocked?.kind === "error" && capability !== undefined)
    await custody.refused(capability, blocked.error.code).catch(() => false)
  return blocked
}

export type AccountNamespaceOptions = {
  readonly custody: CustodyLog
  readonly access: AccountAccess
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly store?: StorePort
  /** How the call bodies load; the real module unless a test passes its own. */
  readonly load?: () => Promise<Pick<typeof import("./account-members"), "accountMembers">>
}

// A load that fails answers this, never the loader's own words or a module path (security design 6).
const UNLOADED = refused("internal_error", "the account calls could not be loaded", "retry; report it if it repeats")

export function accountNamespace(options: AccountNamespaceOptions): NamespaceServing {
  const load = options.load ?? (() => import("./account-members"))
  let bodies: Promise<NamespaceServing["members"]> | undefined
  // A failed load is not kept: the next call tries again.
  const loaded = () =>
    (bodies ??= load()
      .then(({ accountMembers }) => accountMembers(options))
      .catch((error: unknown) => {
        bodies = undefined
        throw error
      }))
  const members = Object.fromEntries(
    ACCOUNT_CALLS.map((key) => [
      key,
      async (...args: unknown[]) => {
        const loadedMembers = await loaded().catch(() => undefined)
        if (loadedMembers === undefined) return UNLOADED
        const member = loadedMembers[key] as (...inner: unknown[]) => unknown
        return member(...args)
      },
    ]),
  ) as { [Key in (typeof ACCOUNT_CALLS)[number]]: MemberOf<Key> }
  return {
    members,
    recordRefusal: (key, code) => {
      const capability = CUSTODY_CALLS[key]
      return capability === undefined ? undefined : options.custody.refused(capability, code).then(() => undefined)
    },
  }
}
