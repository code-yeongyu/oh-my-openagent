import { homedir } from "node:os"
import { join } from "node:path"
import { type HelperAccess, resolveHelperAccess } from "./access"
import { type ApprovalCache, processApprovalCache } from "./approval-cache"
import { HelperReadError, readThroughHelper, type Row8bChoice } from "./darwin-read"
import { lockedDarwinStore, type LockedDarwinStore } from "./darwin-store"
import type { HelperLease } from "./client"
import { bundleCandidates, machineCandidates } from "./location"
import { type MarkerProbe, probeOwnerMarker } from "./owner-marker"
import { keychainProcessState } from "./process-state"
import { promptLockAt } from "./prompt-lock"
import { gatedSecrets, silentSecrets } from "./secrets-gate"

type SecretKey = { readonly service: string; readonly name: string }
type Secrets = {
  readonly get: (key: SecretKey) => Promise<string | null>
  readonly set: (key: SecretKey & { readonly value: string }) => Promise<void>
  readonly delete: (key: SecretKey) => Promise<boolean>
}

/**
 * Row 9b (addendum, ruled 2026-10-28): the item is helper-owned but no verified helper exists on this machine.
 * "reinstall-notice" (default) fails with a one-line notice and no dialog; "dialog" takes today's read, which prompts.
 */
export type Row9bChoice = "reinstall-notice" | "dialog"
export const ROW_9B_DEFAULT: Row9bChoice = "reinstall-notice"

/** Entry points with their own layout (the compiled binary's `execDir`, the desktop runtime) register their copy first. */
export function registerHelperCandidates(paths: readonly string[]): void {
  const { entryCandidates } = keychainProcessState()
  entryCandidates.unshift(...paths.filter(path => !entryCandidates.includes(path)))
}

/**
 * One resolution per process, shared by every bundled copy. An `unavailable` result (a transient pin or copy failure)
 * is not kept: the next resolve tries again, so a long-lived process does not stay on the helper-less path.
 */
export const helperAccess = (): Promise<HelperAccess> =>
  sharedHelperAccess(() => {
    const { entryCandidates } = keychainProcessState()
    return resolveHelperAccess([...entryCandidates, ...bundleCandidates(import.meta.url), ...machineCandidates(homedir())])
  })

export function sharedHelperAccess(resolve: () => Promise<HelperAccess>): Promise<HelperAccess> {
  const state = keychainProcessState()
  if (state.helperAccess !== undefined) return state.helperAccess
  const started = resolve()
  state.helperAccess = started
  void started.then(access => {
    if (access.kind === "unavailable" && state.helperAccess === started) state.helperAccess = undefined
  })
  return started
}

export class HelperMissingForOwnedItem extends Error {}

/** The error shapes keystore.ts already maps: a locked keychain carries -25308; a pending approval is its own kind. */
export function asKeystoreError(error: unknown, pending: (message: string) => Error): unknown {
  if (!(error instanceof HelperReadError)) return error
  if (error.failure === "pending") return pending(error.message)
  if (error.failure === "locked") return Object.assign(new Error(error.message), { code: "-25308" })
  return error
}

/** What a test (or an entry point) may substitute; production uses the defaults. */
export type KeychainHelperOptions = {
  readonly access?: () => Promise<HelperAccess>
  readonly ownerMarker?: MarkerProbe
  readonly silently?: <T>(run: () => Promise<T>) => Promise<T>
  readonly home?: string
  readonly row8b?: Row8bChoice
  readonly row9b?: Row9bChoice
  readonly cache?: ApprovalCache
  readonly handOff?: () => Promise<boolean>
  readonly noDialog?: boolean
}

export type DarwinBackend = {
  /** The read every caller outside the session lock shares (it may show the one plain approval dialog). */
  readonly read: () => Promise<string | null>
  readonly underLock: (lease: HelperLease) => LockedDarwinStore
}

export function createDarwinBackend(options: {
  readonly access: Extract<HelperAccess, { kind: "ready" }>
  readonly secrets: Secrets
  readonly service: string
  readonly account: string
  readonly background: boolean
  readonly notice: (message: string) => void
  readonly home?: string
  readonly row8b?: Row8bChoice
  readonly silently?: <T>(run: () => Promise<T>) => Promise<T>
  readonly cache?: ApprovalCache
  readonly handOff?: () => Promise<boolean>
  readonly noDialog?: boolean
}): DarwinBackend {
  const silently = options.silently ?? silentSecrets
  const key = { service: options.service, name: options.account }
  const deps = {
    account: options.account,
    access: options.access,
    cache: options.cache ?? processApprovalCache(),
    background: options.background,
    takePromptLock: promptLockAt(join(options.home ?? homedir(), ".omo", "session-locks", `${options.account}.keychain-prompt`)),
    ownSilentGet: () => silently(() => options.secrets.get(key)),
    ownOverwrite: (value: string) => silently(() => options.secrets.set({ ...key, value })),
    ownDelete: (name: string) =>
      name === options.account
        ? gatedSecrets(() => options.secrets.delete({ ...key, name }))
        : silently(() => options.secrets.delete({ ...key, name })),
    notice: options.notice,
    ...(options.row8b === undefined ? {} : { row8b: options.row8b }),
    ...(options.handOff === undefined ? {} : { handOff: options.handOff }),
    noDialog: options.noDialog === true,
  }
  return {
    read: async () => {
      const result = await readThroughHelper(deps, true)
      return result.kind === "value" ? result.value : null
    },
    underLock: lease => lockedDarwinStore(deps, lease),
  }
}

/**
 * Without a verified helper, the read is today's, except for an item the helper owns (row 9b): today's read could
 * only reach it through a dialog, so by default this answers with the reinstall notice instead.
 */
export async function guardHelperlessRead(
  service: string,
  account: string,
  choice: Row9bChoice = ROW_9B_DEFAULT,
  probe: MarkerProbe = probeOwnerMarker,
): Promise<void> {
  if (choice === "dialog") return
  if ((await probe(service, account)) === "helper-owned")
    throw new HelperMissingForOwnedItem("OmO's keychain helper is missing or damaged on this Mac. Reinstall omo, then try again.")
}
