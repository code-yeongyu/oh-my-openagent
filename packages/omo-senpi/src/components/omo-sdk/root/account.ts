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
import { type CustodyLog, custodyLog } from "@oh-my-opencode/account-core/calls/custody-log"
import { accountForget } from "@oh-my-opencode/account-core/calls/forget"
import { accountHome } from "@oh-my-opencode/account-core/credential-lock"
import { accountShow, type SyncState } from "@oh-my-opencode/account-core/calls/show"
import { accountSignInCheck, accountSignOut } from "@oh-my-opencode/account-core/calls/sign-out"
import { resolveMemoryRoot, syncPinDir } from "@oh-my-opencode/memory-core/sync-device-retire"
import { type AccountAccess, failure } from "../access"
import { OMO_CODE_REGISTRY, type OmoFailure, type OmoPrincipal, type OmoValue } from "../contract"
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
    case "switch_failed":
      return failed("credential_store_unavailable", refusal.message, { reason: "switch_failed", store: refusal.store })
  }
}

async function answer<Value>(access: AccountAccess, run: () => Promise<OmoValue<Value>>): Promise<OmoValue<Value>> {
  const blocked = access.blockedReason()
  if (blocked !== undefined) return blocked
  try {
    return await run()
  } catch (error) {
    return failure(error)
  }
}

type Env = Readonly<Record<string, string | undefined>>

async function trustPinState(env: Env, cwd: string, account: string): Promise<SyncState> {
  const { loadTrustAnchor } = await import("#omo-memory-sync-runtime")
  const pin = await loadTrustAnchor(syncPinDir(resolveMemoryRoot(env, cwd)), account)
  if (pin.ok) return "joined"
  return pin.reason === "corrupt_pin" ? "corrupt_pin" : "not_joined"
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
  readonly principal: OmoPrincipal
  readonly custody?: CustodyLog
  readonly access: AccountAccess
  readonly env: Env
  readonly cwd: string
  readonly store?: StorePort
}): NamespaceServing {
  const { access } = options
  const custody =
    options.custody ??
    custodyLog({
      home: accountHome(),
      principal: { kind: options.principal.kind, id: principalId(options.principal) },
    })
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
        answer(access, async () => {
          const { revoked, ...note } = await accountSignOut({ session: access.account().session, custody })
          return { kind: "ok", value: { signedOut: true, revoked, ...auditNote(note) } }
        }),
      "account.forget": (input) =>
        answer(access, async () => {
          const forgotten = await accountForget(
            { ...access.account(), custody },
            input?.device === undefined ? {} : { device: input.device },
          )
          if (forgotten.kind === "ok") return { kind: "ok", value: { forgotten: true, ...auditNote(forgotten.value) } }
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
        }),
      "account.show": (input) =>
        answer(access, async () => {
          const shown = await accountShow(
            {
              api: access.origin,
              store: access.store(),
              syncState: (account) => trustPinState(options.env, options.cwd, account),
            },
            input?.account === undefined ? {} : { account: input.account },
          )
          return shown.kind === "ok"
            ? shown
            : failed("invalid_arguments", "account must name an account id.", { field: "account" })
        }),
      "account.store.status": () => answer(access, async () => ({ kind: "ok", value: storeStatus(store) })),
      "account.store.enable": () =>
        answer(access, async () => {
          const enabled = await storeEnable(store)
          return enabled.kind === "ok" ? enabled : storeRefusal(enabled)
        }),
      "account.store.disable": (input) =>
        answer(access, async () => {
          const disabled = await storeDisable(store, { discard: input?.discard === true })
          return disabled.kind === "ok" ? disabled : storeRefusal(disabled)
        }),
    },
  }
}
