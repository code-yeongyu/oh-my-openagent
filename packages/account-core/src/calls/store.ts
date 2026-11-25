import { withCredentialLock } from "../credential-lock"
import type { HelperAccess } from "../keychain-helper/access"
import { type DedicatedStoreState, dedicatedStoreRoot } from "../keychain-helper/dedicated-store"
import {
  type DisableOutcome,
  type EnableOutcome,
  StoreSwitchError,
  storeSwitch,
} from "../keychain-helper/dedicated-switch"
import { credentialId } from "../keystore"
import { type CallOutcome, ok, refusedWith } from "./outcome"

// account.store.status, enable and disable (#13116, first-party design 6.4): OmO's own keychain for a Mac whose login
// keychain stays locked. Each answers typed fields only; `omo account store` renders its line and its notes from them.

export type StoreDependencies = {
  readonly api: string
  readonly platform: NodeJS.Platform
  readonly state: () => DedicatedStoreState
  readonly access: () => Promise<HelperAccess>
  readonly home?: string
}

/** Where the sign-in lives: OmO's own keychain once it is active, else the login keychain. The path is the store's own. */
export type StoreStatus = {
  readonly store: "omo" | "login"
  readonly state: DedicatedStoreState
  readonly path: string
}
export type StoreEnabled = { readonly store: "omo" } & EnableOutcome
export type StoreDisabled = { readonly store: "login" } & DisableOutcome

export type StoreRefusal =
  | { readonly code: "macos_only" }
  | { readonly code: "helper_unavailable" }
  /** The helper refused a step of the switch; `message` is this module's or the helper refusal table's own words. */
  | { readonly code: "switch_failed"; readonly message: string; readonly store: "omo" | "login" }

const storeOf = (state: DedicatedStoreState): "omo" | "login" => (state === "active" ? "omo" : "login")

export function storeStatus(deps: Pick<StoreDependencies, "platform" | "state">): StoreStatus {
  const state = deps.platform === "darwin" ? deps.state() : "absent"
  return { store: storeOf(state), state, path: dedicatedStoreRoot() }
}

type Switcher = ReturnType<typeof storeSwitch>

async function switching<Value>(
  deps: StoreDependencies,
  run: (switcher: Switcher) => Promise<Value>,
): Promise<CallOutcome<Value, StoreRefusal>> {
  if (deps.platform !== "darwin") return refusedWith({ code: "macos_only" })
  const access = await deps.access()
  if (access.kind !== "ready") return refusedWith({ code: "helper_unavailable" })
  try {
    return ok(
      await withCredentialLock(
        deps.api,
        (lease) => run(storeSwitch({ access, account: credentialId(deps.api), lease, state: deps.state })),
        deps.home,
      ),
    )
  } catch (error) {
    if (!(error instanceof StoreSwitchError)) throw error
    return refusedWith({ code: "switch_failed", message: error.message, store: storeOf(deps.state()) })
  }
}

export async function storeEnable(deps: StoreDependencies): Promise<CallOutcome<StoreEnabled, StoreRefusal>> {
  const outcome = await switching(deps, (switcher) => switcher.enable())
  return outcome.kind === "ok" ? ok({ store: "omo", ...outcome.value }) : outcome
}

export async function storeDisable(
  deps: StoreDependencies,
  input: { readonly discard?: boolean },
): Promise<CallOutcome<StoreDisabled, StoreRefusal>> {
  const outcome = await switching(deps, (switcher) => switcher.disable(input.discard === true))
  return outcome.kind === "ok" ? ok({ store: "login", ...outcome.value }) : outcome
}

/** The store as the root's credential-store port reaches it (first-party design 4.6): a fake replaces all three. */
export type StorePort = {
  readonly status: () => StoreStatus
  readonly enable: () => Promise<CallOutcome<StoreEnabled, StoreRefusal>>
  readonly disable: (input: { readonly discard?: boolean }) => Promise<CallOutcome<StoreDisabled, StoreRefusal>>
}

export const storePort = (deps: StoreDependencies): StorePort => ({
  status: () => storeStatus(deps),
  enable: () => storeEnable(deps),
  disable: (input) => storeDisable(deps, input),
})
