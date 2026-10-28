// Every Bun.secrets call in the process goes through this one queue (#11262 design 3.2 step 2). Bun.secrets runs on a
// thread pool, and keychain interaction is a process-wide switch: a call that started while another call had turned
// interaction off would see -25308 and report "locked". So calls run one at a time, each to completion, and a silent
// call turns interaction off only for its own duration.

import { keychainProcessState } from "./process-state"

type InteractionSwitch = (allowed: boolean) => void

async function loadInteractionSwitch(): Promise<InteractionSwitch | null> {
  const state = keychainProcessState()
  if (state.interactionSwitch !== undefined) return state.interactionSwitch
  if (process.platform !== "darwin") return (state.interactionSwitch = null)
  try {
    const { dlopen, FFIType } = await import("bun:ffi")
    const security = dlopen("/System/Library/Frameworks/Security.framework/Security", {
      SecKeychainSetUserInteractionAllowed: { args: [FFIType.u8], returns: FFIType.i32 },
    })
    state.interactionSwitch = allowed => {
      security.symbols.SecKeychainSetUserInteractionAllowed(allowed ? 1 : 0)
    }
  } catch {
    state.interactionSwitch = null
  }
  return state.interactionSwitch
}

/** Runs one Bun.secrets call after every earlier one has settled. */
export function gatedSecrets<T>(run: () => Promise<T>): Promise<T> {
  const state = keychainProcessState()
  const next = state.secretsQueue.then(run, run)
  state.secretsQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** As `gatedSecrets`, with keychain interaction off for exactly this call: it can never show a dialog. */
export function silentSecrets<T>(run: () => Promise<T>): Promise<T> {
  return gatedSecrets(async () => {
    const setInteraction = await loadInteractionSwitch()
    if (setInteraction === null) throw new Error("Keychain interaction cannot be switched off on this host.")
    setInteraction(false)
    try {
      return await run()
    } finally {
      setInteraction(true)
    }
  })
}
