export type AccountShowResult = { readonly exitCode: number; readonly stdout: string }

export type AccountState =
  | { readonly kind: "signed_in"; readonly device: { readonly id: string; readonly name: string }; readonly refreshState: string }
  | { readonly kind: "signed_out" }
  | { readonly kind: "keychain_locked" }
  | { readonly kind: "store_unavailable" }
  | { readonly kind: "account_unavailable"; readonly reason: string }

const KEYCHAIN_LOCKED_EXIT = 7
const STORE_UNAVAILABLE_EXITS: readonly number[] = [8, 9]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0

function lastJsonLine(stdout: string): unknown {
  const line = stdout.trim().split("\n").at(-1)
  if (line === undefined || line === "") return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/**
 * Classifies `omo account show` by its JSON, never by the exit code alone: signed in and signed out both exit 0 and
 * differ only in `signedIn`, while 7 is a locked keychain and 8/9 an unavailable credential store.
 */
export function classifyAccountShow(result: AccountShowResult): AccountState {
  const value = lastJsonLine(result.stdout)
  if (result.exitCode === KEYCHAIN_LOCKED_EXIT && isRecord(value) && value.keychain === "locked") return { kind: "keychain_locked" }
  if (STORE_UNAVAILABLE_EXITS.includes(result.exitCode)) return { kind: "store_unavailable" }
  if (!isRecord(value)) return { kind: "account_unavailable", reason: "omo account show printed no JSON" }
  if (value.signedIn === false) return { kind: "signed_out" }
  if (value.signedIn === true && result.exitCode === 0) {
    const device = value.device
    if (isRecord(device) && text(device.id) && text(device.name))
      return {
        kind: "signed_in",
        device: { id: device.id, name: device.name },
        refreshState: text(value.refreshState) ? value.refreshState : "ok",
      }
  }
  return { kind: "account_unavailable", reason: `omo account show answered an unexpected shape (exit ${result.exitCode})` }
}

/** The one line a user can act on for each state that stops the bootstrap; undefined when signed in. */
export function accountStateNotice(state: AccountState): string | undefined {
  switch (state.kind) {
    case "signed_in":
      return undefined
    case "signed_out":
      return "Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."
    case "keychain_locked":
      return "Your OmO sign-in is behind a locked keychain. Unlock it, then try again."
    case "store_unavailable":
      return "The credential store holding your OmO sign-in is not available right now. Try again in a moment."
    case "account_unavailable":
      return `Could not read your OmO sign-in (${state.reason}). Sign in again with omo login.`
  }
}
