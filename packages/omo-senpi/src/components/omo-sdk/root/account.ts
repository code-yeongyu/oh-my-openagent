import {
  type StorePort,
  type StoreRefusal,
  storeDisable,
  storeEnable,
  storeStatus,
  storeSwitchPort,
} from "@oh-my-opencode/account-core/calls/store"
import { helperAccess } from "@oh-my-opencode/account-core/keychain-helper/darwin-backend"
import { dedicatedStoreState } from "@oh-my-opencode/account-core/keychain-helper/dedicated-store"
import { type CustodyCapability, type CustodyLog, custodyLog } from "@oh-my-opencode/account-core/calls/custody-log"
import { accountForget } from "@oh-my-opencode/account-core/calls/forget"
import { accountHome } from "@oh-my-opencode/account-core/credential-lock"
import { InvalidCredentialState } from "@oh-my-opencode/account-core/keystore"
import { accountShow, type SyncState } from "@oh-my-opencode/account-core/calls/show"
import { accountSignInCheck, accountSignOut } from "@oh-my-opencode/account-core/calls/sign-out"
import { resolveMemoryRoot, syncPinDir } from "@oh-my-opencode/memory-core/sync-device-retire"
import { loadTrustAnchor } from "@oh-my-opencode/memory-core/sync-trust-pin-read"
import { type AccountAccess, failure } from "../access"
import type { OmoResult } from "../result"
import { OMO_CODE_REGISTRY, type OmoFailure, type OmoPrincipal, type OmoValue, type RootCallKey } from "../contract"
import type { NamespaceServing } from "./members"

// The account calls of first-party design 6.4 that slice A1b serves on the root, each over its one body in the account
// core. Every call answers desktop_sign_in under a desktop launch first (security design 4.2); the principal refusals of
// 4.2 are answered at the root boundary before a call runs (authority.ts).

const failed = (
  code: keyof typeof OMO_CODE_REGISTRY,
  message: string,
  details: Record<string, unknown>,
): OmoFailure => ({
  kind: "error",
  error: { code, message, next_action: OMO_CODE_REGISTRY[code].next_action, details },
})

function storeRefusal(refusal: StoreRefusal): OmoFailure {
  switch (refusal.code) {
    case "macos_only":
      return failed("unsupported", "OmO's own keychain exists on macOS only.", { reason: "macos_only" })
    case "helper_unavailable":
      return failed("credential_store_unavailable", "OmO's keychain helper is missing or failed its signature check.", {
        reason: "helper_unavailable",
      })
    // The helper's own reply never reaches the answer (security design 6): the store it was moving names the failure.
    case "switch_failed":
      return failed("credential_store_unavailable", "OmO could not move the sign-in between keychains.", {
        reason: "switch_failed",
        store: refusal.store,
      })
  }
}

// The root calls that bear custody (security design 8.2), each with the capability its records name.
const CUSTODY_CALLS: Partial<Record<RootCallKey, CustodyCapability>> = {
  "account.signIn": "account.signIn",
  "account.signOut": "account.signOut",
  "account.forget": "account.forget",
  "account.store.enable": "account.store.enable",
  "account.store.disable": "account.store.disable",
}

/** This root's custody log: the account home's own, its principal the root's. */
export const rootCustodyLog = (principal: OmoPrincipal): CustodyLog =>
  custodyLog({ home: accountHome(), principal: { kind: principal.kind, id: principalId(principal) } })

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

async function answer<Value>(
  access: AccountAccess,
  run: () => Promise<OmoValue<Value>>,
  custody?: { readonly log: CustodyLog; readonly capability: CustodyCapability },
): Promise<OmoValue<Value>> {
  const blocked = await launchBlocked(access, custody?.log ?? NO_LOG, custody?.capability)
  if (blocked !== undefined) return blocked
  try {
    return await run()
  } catch (error) {
    return failure(error)
  }
}

type Env = Readonly<Record<string, string | undefined>>

async function trustPinState(env: Env, cwd: string, account: string): Promise<SyncState> {
  const pin = await loadTrustAnchor(syncPinDir(resolveMemoryRoot(env, cwd)), account)
  if (pin.ok) return "joined"
  return pin.reason === "corrupt_pin" ? "corrupt_pin" : "not_joined"
}

const NO_LOG: CustodyLog = {
  begin: async () => ({ recorded: false, end: async () => false }),
  refused: async () => false,
}

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

const auditNote = (value: { readonly auditUnavailable?: true }) =>
  value.auditUnavailable === true ? { audit_unavailable: true as const } : {}

export function accountNamespace(options: {
  readonly custody: CustodyLog
  readonly access: AccountAccess
  readonly env: Env
  readonly cwd: string
  readonly store?: StorePort
}): NamespaceServing {
  const { access } = options
  const { custody } = options
  const logged = (capability: CustodyCapability) => ({ log: custody, capability })
  const store =
    options.store ??
    storeSwitchPort({
      api: access.origin,
      platform: process.platform,
      state: () => dedicatedStoreState(),
      access: helperAccess,
    })
  return {
    members: {
      "account.signInCheck": async () => ({ kind: "ok", value: accountSignInCheck() }),
      "account.signOut": () =>
        answer(
          access,
          async () => {
            const { revoked, ...note } = await accountSignOut({ session: access.account().session, custody })
            return { kind: "ok", value: { signedOut: true, revoked, ...auditNote(note) } }
          },
          logged("account.signOut"),
        ),
      "account.forget": (input) =>
        answer(
          access,
          async () => {
            const forgotten = await accountForget(
              { ...access.account(), custody },
              input?.device === undefined ? {} : { device: input.device },
            )
            if (forgotten.kind === "ok")
              return { kind: "ok", value: { forgotten: true, ...auditNote(forgotten.value) } }
            switch (forgotten.code) {
              case "empty_device":
                return failed("invalid_arguments", "device must name this device's id.", {
                  field: "device",
                  reason: "empty_device",
                })
              case "other_device":
                return failed(
                  "invalid_arguments",
                  "account.forget acts on this device only; another device is devices.revoke.",
                  {
                    field: "device",
                    reason: "other_device",
                    device: forgotten.device,
                  },
                )
              case "unreadable_credential":
                return failed("credential_store_unavailable", "The stored sign-in could not be read.", {
                  reason: "unreadable_credential",
                })
            }
          },
          logged("account.forget"),
        ),
      "account.show": (input) =>
        answer(access, async () => {
          // show reads only this machine's store: an item it cannot parse is that store's failure, as for forget.
          const shown = await accountShow(
            {
              api: access.origin,
              store: access.store(),
              syncState: (account) => trustPinState(options.env, options.cwd, account),
            },
            input?.account === undefined ? {} : { account: input.account },
          ).catch((error: unknown) => {
            if (error instanceof InvalidCredentialState) return "unreadable" as const
            throw error
          })
          if (shown === "unreadable")
            return failed("credential_store_unavailable", "The stored sign-in could not be read.", {
              reason: "unreadable_credential",
            })
          return shown.kind === "ok"
            ? shown
            : failed("invalid_arguments", "account must name an account id.", { field: "account" })
        }),
      "account.store.status": () => answer(access, async () => ({ kind: "ok", value: storeStatus(store) })),
      "account.store.enable": () =>
        answer(
          access,
          async () => {
            const enabled = await storeEnable(store, custody)
            if (enabled.kind !== "ok") return storeRefusal(enabled)
            const { auditUnavailable: _note, ...value } = enabled.value
            return { kind: "ok", value: { ...value, ...auditNote(enabled.value) } }
          },
          logged("account.store.enable"),
        ),
      "account.store.disable": (input) =>
        answer(
          access,
          async () => {
            const disabled = await storeDisable(store, { discard: input?.discard === true }, custody)
            if (disabled.kind !== "ok") return storeRefusal(disabled)
            const { auditUnavailable: _note, ...value } = disabled.value
            return { kind: "ok", value: { ...value, ...auditNote(disabled.value) } }
          },
          logged("account.store.disable"),
        ),
    },
    recordRefusal: (key, code) => {
      const capability = CUSTODY_CALLS[key]
      return capability === undefined ? undefined : custody.refused(capability, code)
    },
  }
}
