import type { StorePort } from "@oh-my-opencode/account-core/calls/store"
import type { CustodyCapability, CustodyLog } from "@oh-my-opencode/account-core/calls/custody-log"
import type { AccountAccess } from "../access"
import type { OmoResult } from "../result"
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

/** This root's custody log: the account home's own, its principal the root's; the log itself loads on its first record. */
export function rootCustodyLog(principal: OmoPrincipal): CustodyLog {
  let log: Promise<CustodyLog> | undefined
  const loaded = () =>
    (log ??= Promise.all([
      import("@oh-my-opencode/account-core/calls/custody-log"),
      import("@oh-my-opencode/account-core/credential-lock"),
    ]).then(([{ custodyLog }, { accountHome }]) =>
      custodyLog({ home: accountHome(), principal: { kind: principal.kind, id: principalId(principal) } }),
    ))
  return {
    begin: async (capability) => (await loaded()).begin(capability),
    refused: async (capability, code) => (await loaded()).refused(capability, code),
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
}

export function accountNamespace(options: AccountNamespaceOptions): NamespaceServing {
  let bodies: Promise<NamespaceServing["members"]> | undefined
  const loaded = () => (bodies ??= import("./account-members").then(({ accountMembers }) => accountMembers(options)))
  const members = Object.fromEntries(
    ACCOUNT_CALLS.map((key) => [
      key,
      async (...args: unknown[]) => {
        const member = (await loaded())[key] as (...inner: unknown[]) => unknown
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
