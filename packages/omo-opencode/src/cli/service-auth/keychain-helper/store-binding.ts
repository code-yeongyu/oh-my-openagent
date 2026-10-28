import { homedir } from "node:os"
import type { SecretApi } from "../keystore"
import type { HelperLease } from "./client"
import {
  asKeystoreError,
  createDarwinBackend,
  type DarwinBackend,
  guardHelperlessRead,
  helperAccess,
  type KeychainHelperOptions,
} from "./darwin-backend"
import type { LockedDarwinStore, WriteIntent } from "./darwin-store"
import { createCreatorHandOff, desktopRuntimeCandidates, HANDOFF_ENV } from "./creator-handoff"
import { keychainProcessState } from "./process-state"
import { gatedSecrets } from "./secrets-gate"

/** The session-lock view of a store (#11262 design 3.3, 3.4, 3.6): every keychain change inside one locked section. */
export type LockedStore<T> = {
  readonly read: () => Promise<T | null>
  readonly write: (value: T, intent?: WriteIntent) => Promise<void>
  readonly clear: () => Promise<void>
  readonly recover: () => Promise<void>
  readonly settle: () => Promise<void>
}

export type HelperBinding = {
  /** The secrets every non-helper path of this store uses: gated when the store is helper-eligible, else as given. */
  readonly secrets: SecretApi
  readonly eligible: boolean
  readonly backend: () => Promise<DarwinBackend | null>
  readonly reader: (backend: DarwinBackend) => SecretApi
  readonly isHelperReader: (api: SecretApi) => boolean
  readonly guardHelperless: () => Promise<void>
}

// One adapter per helper-backed account per process, so every store in the process shares the same pending read.
const readers = new Map<DarwinBackend, SecretApi>()
const backends = new Map<string, Promise<DarwinBackend | null>>()

// Addendum change 1: at most one hand-off attempt per process (shared by every bundled copy), to the installed and
// verified desktop app, for the origin this store serves.
function processHandOff(origin: string): () => Promise<boolean> {
  return () => {
    const state = keychainProcessState()
    state.handOff ??= createCreatorHandOff({ candidates: desktopRuntimeCandidates(homedir()), origin })()
    return state.handOff
  }
}

/**
 * Only the real macOS store of the sign-in item gets the signed helper (or a store a test hands helper options to);
 * Windows, Linux, the other namespaces and injected stores keep exactly today's path.
 */
export function bindKeychainHelper(input: {
  readonly platform: NodeJS.Platform
  readonly namespace: string
  readonly secrets: SecretApi
  readonly key: { readonly service: string; readonly name: string }
  readonly background: boolean
  readonly origin: string
  readonly notice: (message: string) => void
  readonly pending: (message: string) => Error
  readonly options?: KeychainHelperOptions
}): HelperBinding {
  const { secrets: real, key, options } = input
  const eligible =
    input.platform === "darwin" && input.namespace === "omo-cli" && (options !== undefined || (typeof Bun !== "undefined" && real === Bun.secrets))
  const secrets: SecretApi = !eligible
    ? real
    : {
        get: entry => gatedSecrets(() => real.get(entry)),
        set: entry => gatedSecrets(() => real.set(entry)),
        delete: entry => gatedSecrets(() => real.delete(entry)),
      }
  const cacheKey = `${key.service}\n${key.name}\n${input.background ? "bounded" : "interactive"}`
  let own: Promise<DarwinBackend | null> | undefined
  const backend = (): Promise<DarwinBackend | null> => {
    if (!eligible) return Promise.resolve(null)
    const known = options === undefined ? backends.get(cacheKey) : own
    if (known !== undefined) return known
    const created = (options?.access ?? helperAccess)().then(access =>
      access.kind !== "ready"
        ? null
        : createDarwinBackend({
            access,
            secrets: real,
            service: key.service,
            account: key.name,
            background: input.background,
            noDialog: options?.noDialog ?? process.env[HANDOFF_ENV] === "1",
            notice: input.notice,
            ...(options?.home === undefined ? {} : { home: options.home }),
            ...(options?.row8b === undefined ? {} : { row8b: options.row8b }),
            ...(options?.silently === undefined ? {} : { silently: options.silently }),
            ...(options?.cache === undefined ? {} : { cache: options.cache }),
            handOff: options === undefined ? processHandOff(input.origin) : (options.handOff ?? (async () => false)),
          }),
    )
    if (options === undefined) {
      backends.set(cacheKey, created)
      // No helper right now (none found, or a transient failure): the next call resolves again instead of keeping it.
      void created.then(found => {
        if (found === null && backends.get(cacheKey) === created) backends.delete(cacheKey)
      })
    } else own = created
    return created
  }
  const reader = (helper: DarwinBackend): SecretApi => {
    const known = readers.get(helper)
    if (known !== undefined) return known
    const refuse = async (): Promise<never> => {
      throw new Error("OmO's keychain helper changes the sign-in only under the session lock.")
    }
    const created: SecretApi = {
      get: async () => {
        try {
          return await helper.read()
        } catch (error) {
          throw asKeystoreError(error, message => input.pending(`${message} Credentials are never saved to a file.`))
        }
      },
      set: refuse,
      delete: refuse,
    }
    readers.set(helper, created)
    return created
  }
  return {
    secrets,
    eligible,
    backend,
    reader,
    isHelperReader: api => [...readers.values()].includes(api),
    guardHelperless: async () => {
      if (!eligible) return
      // A hand-off child never shows a dialog, not even on today's helper-less read (#11613 review).
      if ((options?.noDialog ?? process.env[HANDOFF_ENV] === "1") === true) throw input.pending("The keychain hand-off cannot show a dialog.")
      await guardHelperlessRead(key.service, key.name, options?.row9b, options?.ownerMarker)
    },
  }
}

/** Adapts the helper's locked view to the store's value type; every error is mapped once and the shared read reset. */
export function lockedStoreView<T>(
  helper: DarwinBackend,
  lease: HelperLease,
  codec: { readonly parse: (text: string) => T; readonly serialize: (value: T) => string },
  mapError: (error: unknown) => unknown,
  done: () => void,
): LockedStore<T> {
  const locked: LockedDarwinStore = helper.underLock(lease)
  const run = async <R>(step: () => Promise<R>): Promise<R> => {
    try {
      return await step()
    } catch (error) {
      throw mapError(error)
    } finally {
      done()
    }
  }
  return {
    read: () =>
      run(async () => {
        const text = await locked.read()
        return text === null ? null : codec.parse(text)
      }),
    write: (value, intent = "update") => run(() => locked.write(codec.serialize(value), intent)),
    clear: () => run(() => locked.clear()),
    recover: () => run(() => locked.recover()),
    settle: () => run(() => locked.settle()),
  }
}
