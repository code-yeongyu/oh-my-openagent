import { type StorePort, type StoreRefusal, storePort } from "@oh-my-opencode/account-core/calls/store"
import { helperAccess } from "@oh-my-opencode/account-core/keychain-helper/darwin-backend"
import { dedicatedStoreState } from "@oh-my-opencode/account-core/keychain-helper/dedicated-store"
import { type AccountAccess, failure } from "../access"
import { OMO_CODE_REGISTRY, type OmoFailure, type OmoValue } from "../contract"
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

export function accountNamespace(options: {
  readonly access: AccountAccess
  readonly store?: StorePort
}): NamespaceServing {
  const { access } = options
  const store =
    options.store ??
    storePort({
      api: access.origin,
      platform: process.platform,
      state: () => dedicatedStoreState(),
      access: helperAccess,
    })
  return {
    members: {
      "account.store.status": () => answer(access, async () => ({ kind: "ok", value: store.status() })),
      "account.store.enable": () =>
        answer(access, async () => {
          const enabled = await store.enable()
          return enabled.kind === "ok" ? enabled : storeRefusal(enabled)
        }),
      "account.store.disable": (input) =>
        answer(access, async () => {
          const disabled = await store.disable({ discard: input?.discard === true })
          return disabled.kind === "ok" ? disabled : storeRefusal(disabled)
        }),
    },
  }
}
