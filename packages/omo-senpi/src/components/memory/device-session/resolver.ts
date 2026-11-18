// The production SyncSessionResolver: from the host's signed-in device (DeviceAccountSource) to one
// memory space's sync session. Signed out answers null; signed in but not yet joined (no trust pin,
// not a member) answers a typed idle reason; both open nothing and write nothing to the network. A
// session that later loses its sign-in (sign-out, revoked device) tells the runner, which closes
// the engine and goes idle.

import type {
  AccountSessionOutcome,
  AccountSessionOptions,
  GitSpaceConfig,
  listRemotes,
  repoHasCommit,
  resolveSpace,
} from "@oh-my-opencode/memory-core/sync-engine"
import type { DeviceKeyMaterial, DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"

import type { SyncSessionRequest, SyncSessionResolution } from "../sync-runner"
import { SyncSessionDeferredError } from "../sync-session-deferred"
import type { DeviceAccountSource } from "./account-source"

const REPO_NOT_CREATED = "the memory repository is not created yet; sync starts after the first memory write."

export interface DeviceSessionRuntime {
  readonly openAccountSession: (options: AccountSessionOptions) => Promise<AccountSessionOutcome>
  readonly deviceKeyringFromMaterial: (material: DeviceKeyMaterial) => Promise<DeviceKeyring>
  readonly GitSpaceConfig: typeof GitSpaceConfig
  readonly listRemotes: typeof listRemotes
  readonly repoHasCommit: typeof repoHasCommit
  readonly resolveSpace: typeof resolveSpace
}

export function createDeviceSessionResolver(options: {
  readonly source: DeviceAccountSource
  /** Where this device keeps its per-account trust pins, outside every memory repository. */
  readonly pinDir: string
  readonly loadRuntime: () => Promise<DeviceSessionRuntime>
  readonly fetch?: typeof fetch
}): (request: SyncSessionRequest) => Promise<SyncSessionResolution> {
  // Repos whose last pass deferred because the memory repository had no first commit yet, with the lifetime signal of
  // the account that pass resolved.
  const awaitingRepo = new Map<string, AbortSignal>()
  return async ({ paths, space }) => {
    // The account was resolved on the pass that deferred; while the repository is still missing and that account is
    // still live, a retry asks no credential and makes no request (a keychain "Allow", not "Always Allow", would
    // otherwise prompt every time). Its signal aborting (signed out, channel closed, #13624) ends the wait: the account
    // is read again, so a signed-out device goes idle and an unavailable one reports why.
    const waiting = awaitingRepo.get(paths.repo)
    if (waiting !== undefined && !waiting.aborted && !(await options.loadRuntime()).repoHasCommit(paths.repo))
      throw new SyncSessionDeferredError(REPO_NOT_CREATED, undefined, waiting)
    awaitingRepo.delete(paths.repo)
    const account = await options.source()
    if (account === null) return null
    if (account.kind === "unavailable") return { idle: account.reason }
    const runtime = await options.loadRuntime()
    if (account.kind === "desktop" && (account.signal.aborted || !(await account.isCurrent()))) return null
    // The space binding lives in the repository's git config, and the repository is created at the first memory write,
    // never by a read or a session start (#13486). Until its first commit lands, the creation may still be writing that
    // config, so the session is deferred and the runner retries it.
    if (!runtime.repoHasCommit(paths.repo)) {
      awaitingRepo.set(paths.repo, account.signal)
      throw new SyncSessionDeferredError(REPO_NOT_CREATED, undefined, account.signal)
    }
    const resolved = runtime.resolveSpace(new runtime.GitSpaceConfig(paths.repo), {
      profile: space.profile,
      remotes: runtime.listRemotes(space.projectDir),
    })
    // A repository that left its per-device local: space (#13720): its older journal is that space's.
    const legacy = resolved.legacySpaceId === null ? {} : { legacySpace: resolved.legacySpaceId }
    const ended = new Set<() => void>()
    if (account.kind === "desktop") {
      const opened = await runtime.openAccountSession({
        account: account.descriptor.accountId,
        keyring: account.keyring,
        chain: account.chain,
        transport: account.transport,
        revocationView: account.revocationView,
        pinDir: options.pinDir,
        spaceId: Uint8Array.from(Buffer.from(resolved.spaceId, "hex")),
      })
      if (account.signal.aborted || !(await account.isCurrent())) return null
      if (!opened.ok) return { idle: opened.reason }
      return {
        ...opened.session,
        ...legacy,
        onEnded: (notify) => {
          if (account.signal.aborted) notify()
          else account.signal.addEventListener("abort", notify, { once: true })
        },
      }
    }
    const token = async (): Promise<string> => {
      try {
        const accessToken = await account.accessToken()
        if (!(await account.isCurrent())) {
          for (const notify of [...ended]) notify()
          throw new Error("memory sync: the account identity changed")
        }
        return accessToken
      } catch (error) {
        if (await account.signedOut()) for (const notify of [...ended]) notify()
        throw error
      }
    }
    const opened = await runtime.openAccountSession({
      baseUrl: account.api,
      token,
      account: account.accountId,
      keyring: await account.keyring(runtime.deviceKeyringFromMaterial),
      pinDir: options.pinDir,
      spaceId: Uint8Array.from(Buffer.from(resolved.spaceId, "hex")),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
    if (!opened.ok) return { idle: opened.reason }
    return {
      ...opened.session,
      ...legacy,
      onEnded: (notify) => {
        ended.add(notify)
      },
    }
  }
}
