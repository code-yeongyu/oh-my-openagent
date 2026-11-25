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

type Switched<Value> = CallOutcome<
  Value,
  Extract<StoreRefusal, { readonly code: "switch_failed" | "helper_unavailable" }>
>

/**
 * The credential store's switch as the root's port reaches it (first-party design 4.6): `status`, `enable` and `disable`
 * are its operations; `platform` and `available` are what the calls check before any operation runs.
 */
export type StorePort = {
  readonly platform: NodeJS.Platform
  readonly available: () => Promise<boolean>
  readonly status: () => StoreStatus
  readonly enable: () => Promise<Switched<StoreEnabled>>
  readonly disable: (input: { readonly discard: boolean }) => Promise<Switched<StoreDisabled>>
}

export type StoreDependencies = {
  readonly api: string
  readonly platform: NodeJS.Platform
  readonly state: () => DedicatedStoreState
  readonly access: () => Promise<HelperAccess>
  readonly home?: string
}

const storeOf = (state: DedicatedStoreState): "omo" | "login" => (state === "active" ? "omo" : "login")

/** The switch over the keychain helper, under the credential lock every refresh write takes. */
export function storeSwitchPort(deps: StoreDependencies): StorePort {
  const switching = async <Value>(
    run: (switcher: ReturnType<typeof storeSwitch>) => Promise<Value>,
  ): Promise<Switched<Value>> => {
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
  return {
    platform: deps.platform,
    available: async () => (await deps.access()).kind === "ready",
    status: () => {
      const state = deps.platform === "darwin" ? deps.state() : "absent"
      return { store: storeOf(state), state, path: dedicatedStoreRoot() }
    },
    enable: async () => {
      const enabled = await switching((switcher) => switcher.enable())
      return enabled.kind === "ok" ? ok({ store: "omo" as const, ...enabled.value }) : enabled
    },
    disable: async ({ discard }) => {
      const disabled = await switching((switcher) => switcher.disable(discard))
      return disabled.kind === "ok" ? ok({ store: "login" as const, ...disabled.value }) : disabled
    },
  }
}

async function ready(
  port: StorePort,
): Promise<Extract<StoreRefusal, { readonly code: "macos_only" | "helper_unavailable" }> | undefined> {
  if (port.platform !== "darwin") return { code: "macos_only" }
  return (await port.available()) ? undefined : { code: "helper_unavailable" }
}

export const storeStatus = (port: StorePort): StoreStatus => port.status()

export async function storeEnable(port: StorePort): Promise<CallOutcome<StoreEnabled, StoreRefusal>> {
  const refusal = await ready(port)
  return refusal === undefined ? port.enable() : refusedWith(refusal)
}

export async function storeDisable(
  port: StorePort,
  input: { readonly discard?: boolean },
): Promise<CallOutcome<StoreDisabled, StoreRefusal>> {
  const refusal = await ready(port)
  return refusal === undefined ? port.disable({ discard: input.discard === true }) : refusedWith(refusal)
}
