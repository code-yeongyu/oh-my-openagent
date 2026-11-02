// The production SyncSessionResolver: from the host's signed-in device (DeviceAccountSource) to one
// memory space's sync session. Signed out answers null; signed in but not yet joined (no trust pin,
// not a member) answers a typed idle reason; both open nothing and write nothing to the network. A
// session that later loses its sign-in (sign-out, revoked device) tells the runner, which closes
// the engine and goes idle.

import type { AccountSessionOutcome, AccountSessionOptions, GitSpaceConfig, listRemotes, resolveSpace } from "@oh-my-opencode/memory-core/sync-engine"
import type { DeviceKeyMaterial, DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"

import type { SyncSessionRequest, SyncSessionResolution } from "../sync-runner"
import type { DeviceAccountSource } from "./account-source"

export interface DeviceSessionRuntime {
  readonly openAccountSession: (options: AccountSessionOptions) => Promise<AccountSessionOutcome>
  readonly deviceKeyringFromMaterial: (material: DeviceKeyMaterial) => Promise<DeviceKeyring>
  readonly GitSpaceConfig: typeof GitSpaceConfig
  readonly listRemotes: typeof listRemotes
  readonly resolveSpace: typeof resolveSpace
}

export function createDeviceSessionResolver(options: {
  readonly source: DeviceAccountSource
  /** Where this device keeps its per-account trust pins, outside every memory repository. */
  readonly pinDir: string
  readonly loadRuntime: () => Promise<DeviceSessionRuntime>
  readonly fetch?: typeof fetch
}): (request: SyncSessionRequest) => Promise<SyncSessionResolution> {
  return async ({ paths, space }) => {
    const account = await options.source()
    if (account === null) return null
    if (account.kind === "unavailable") return { idle: account.reason }
    const runtime = await options.loadRuntime()
    if (account.kind === "desktop" && (account.signal.aborted || !await account.isCurrent())) return null
    const resolved = runtime.resolveSpace(new runtime.GitSpaceConfig(paths.repo), { profile: space.profile, remotes: runtime.listRemotes(space.projectDir) })
    const ended = new Set<() => void>()
    if (account.kind === "desktop") {
      const opened = await runtime.openAccountSession({
        account: account.descriptor.accountId,
        keyring: account.keyring,
        chain: account.chain,
        transport: account.transport,
        pinDir: options.pinDir,
        spaceId: Uint8Array.from(Buffer.from(resolved.spaceId, "hex")),
      })
      if (account.signal.aborted || !await account.isCurrent()) return null
      if (!opened.ok) return { idle: opened.reason }
      return {
        ...opened.session,
        onEnded: (notify) => {
          if (account.signal.aborted) notify()
          else account.signal.addEventListener("abort", notify, { once: true })
        },
      }
    }
    const token = async (): Promise<string> => {
      try {
        const accessToken = await account.accessToken()
        if (!await account.isCurrent()) {
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
      onEnded: (notify) => {
        ended.add(notify)
      },
    }
  }
}
