import type { ThreadDevice, ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { listedThread } from "../control/relay-session-host"
import { threadRow } from "../tools/thread-row"
import {
  rowThreadId,
  type AliasRegistry,
  type RemoteDevice,
  type RemoteListing,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "./ports"
import { remoteNotSetUp } from "./address-book"
import type { WorktreeRequest } from "../worktree/thread-worktree"
import { placeFolder } from "./create-folder"
import { accountDevices } from "./account"
import { aliasFailure, remoteReady } from "./remote-ops"
import {
  planCreate as placeCreate,
  signedOut,
  type CreatePlan,
  type LocalAliasReason,
  type LocalPlacement,
} from "./plan-create"

/**
 * thread_create's placement (`plan-create.ts`: which device, which session) and then its folder (`create-folder.ts`:
 * a relative cwd, the worktree). A worktree is only for a new thread.
 */
export async function planCreate(
  remote: RemoteThreadSurface | undefined,
  value: Parameters<typeof placeCreate>[1] & { readonly worktree?: WorktreeRequest },
  local: LocalPlacement,
): Promise<CreatePlan> {
  if (value.worktree !== undefined && value.thread !== undefined)
    return {
      kind: "done",
      result: {
        kind: "error",
        error: threadToolFailure(
          "invalid_arguments",
          "worktree creates a new thread's folder; thread opens an existing thread.",
          "Drop worktree to open the thread, or drop thread to create a new one in a worktree.",
        ),
      },
    }
  const plan = placeFolder(await placeCreate(remote, value, local), value.worktree, local.callerCwd)
  if (plan.kind !== "open" || plan.request.forkFrom === undefined) return plan
  // The engine's open_session does not read forkFrom (#13031): an open carrying it would start a blank thread.
  return {
    kind: "done",
    result: {
      kind: "error",
      error: threadToolFailure(
        "unsupported",
        "fork_from cannot fork yet: the engine opens a blank session instead of a fork, so no thread was created.",
        "Create the thread without fork_from and hand it the source's context with thread_send; thread_read reads the source.",
        {
          reason: "fork_unsupported",
          thread: plan.request.forkFrom,
          ...(plan.host.device === undefined ? {} : { device: plan.host.device }),
        },
      ),
    },
  }
}

export {
  type CreatePlan,
  type CrossTarget,
  type LocalAliasReason,
  type LocalExisting,
  type LocalPlacement,
} from "./plan-create"

/**
 * Claims the alias for a thread just created. Every failure after the create - a lost race (alias_taken), or the
 * registry or device service failing outright - answers with the created thread named, so it is never orphaned.
 */
export async function withAlias(
  remote: RemoteThreadSurface | undefined,
  alias: string | undefined,
  result: ThreadToolResult,
  device?: string,
): Promise<ThreadToolResult> {
  const claimed = await claimCreatedAlias(remote, alias, result, device, false)
  return "local" in claimed ? result : claimed
}

/**
 * withAlias for a thread this call just created: an account gone by the claim (`sign_in`, e.g. a token that expired
 * after the resolve) answers `{ local: "sign_in" }` instead of a failure, so the caller names the thread by the alias
 * on its device, exactly as when no account was there to begin with (#13104).
 */
export async function claimCreatedAlias(
  remote: RemoteThreadSurface | undefined,
  alias: string | undefined,
  result: ThreadToolResult,
  device?: string,
  localWhenSignedOut = true,
): Promise<ThreadToolResult | { readonly local: "sign_in" }> {
  if (remote?.aliases === undefined || alias === undefined || result.kind !== "ok" || !("thread" in result))
    return result
  let claimed: Awaited<ReturnType<AliasRegistry["claim"]>>
  try {
    const holderDevice = device ?? (await accountDevices(remote.client)).here ?? ""
    claimed = await remote.aliases.claim({
      alias,
      holder: { session_id: result.thread, device: holderDevice },
      idempotency_key: `create:${result.thread}`,
    })
  } catch (error) {
    claimed = {
      kind: "error",
      error: {
        code: "alias_registry_unavailable",
        message: `The thread was created, but its alias could not be claimed: ${error instanceof Error ? error.message : String(error)}.`,
        details: { reason: "claim_failed" },
      },
    }
  }
  if (claimed.kind === "error") {
    if (localWhenSignedOut && signedOut(claimed.error)) return { local: "sign_in" }
    const failed = aliasFailure(claimed.error)
    return {
      kind: "error",
      error: { ...failed.error, details: { ...(failed.error.details ?? {}), thread: result.thread } },
    }
  }
  return { ...result, alias: claimed.value.alias } as ThreadToolResult
}

/**
 * thread_rename's alias half: claim when the thread holds none, else an atomic rename; a duplicate is alias_taken. With
 * no account to hold it (#13104) it changes nothing and answers `local`, so the caller can make the alias the name.
 */
export async function renameAlias(
  remote: RemoteThreadSurface | undefined,
  threadId: string,
  device: string | undefined,
  alias: string,
  key: string,
): Promise<ThreadToolResult | { readonly local: LocalAliasReason } | undefined> {
  if (remote === undefined) return { local: "no_remote" }
  if (remote.aliases === undefined) return { local: "no_registry" }
  const current = await remote.aliases.aliasesOf([threadId])
  if (current.kind === "error") return signedOut(current.error) ? { local: "sign_in" } : aliasFailure(current.error)
  const from = current.value.get(threadId)
  const holderDevice = device ?? (await accountDevices(remote.client)).here ?? ""
  const changed =
    from === undefined
      ? await remote.aliases.claim({
          alias,
          holder: { session_id: threadId, device: holderDevice },
          idempotency_key: key,
        })
      : await remote.aliases.rename({ session_id: threadId, from, to: alias, idempotency_key: key })
  if (changed.kind !== "error") return undefined
  // The account can be gone by the claim or rename even when aliasesOf answered (a token that expired in between).
  return signedOut(changed.error) ? { local: "sign_in" } : aliasFailure(changed.error)
}

async function accountListing(remote: RemoteThreadSurface): Promise<RemoteListing> {
  if (remote.sessions.listing !== undefined) return await remote.sessions.listing()
  return { rows: await remote.sessions.sessions(), incomplete: [] }
}

// `threads` counts the threads THIS result lists on the device, so it reads the same for every row: this device's are
// the caller's scoped local threads, another device's are its rows merged into the result.
function deviceRows(
  roster: readonly RemoteDevice[],
  self: { readonly id: string | null; readonly name: string | null },
  incomplete: readonly string[],
  threads: readonly { readonly device?: string }[],
): readonly ThreadDevice[] {
  const missing = new Set(incomplete)
  // The account roster leaves this device out (relayd lists only peers), so this device's row is made here.
  const devices: readonly RemoteDevice[] =
    self.id === null || roster.some((row) => row.device === self.id)
      ? roster
      : [
          {
            device: self.id,
            label: self.name ?? self.id,
            online: true,
            platform: process.platform,
            last_seen_ms: null,
          },
          ...roster,
        ]
  return devices.map((row) => {
    const thisDevice = row.device === self.id
    return {
      device: row.device,
      name: row.label,
      ...(row.platform === undefined ? {} : { platform: row.platform }),
      ...(row.kind === undefined ? {} : { kind: row.kind }),
      online: thisDevice || row.online,
      last_seen:
        row.last_seen_ms === undefined || row.last_seen_ms === null ? null : new Date(row.last_seen_ms).toISOString(),
      this_device: thisDevice,
      listing: thisDevice ? "listed" : !row.online ? "offline" : missing.has(row.device) ? "incomplete" : "listed",
      threads: threads.filter((thread) => (thread.device ?? self.id) === row.device).length,
    }
  })
}

/**
 * thread_list: this device's threads (scoped by `all_scope` as before) merged with the account's other devices' threads
 * (each with its device, any workspace), with aliases, and the account's devices with their listing state. A device
 * whose rows this listing could not include is named `incomplete` in `devices`, never silently left out.
 */
export async function listAcross(
  remote: RemoteThreadSurface | undefined,
  local: ThreadToolResult,
  allScope: boolean,
): Promise<ThreadToolResult> {
  if (remote === undefined || local.kind !== "ok" || !("threads" in local)) return local
  const ids = local.threads.map((thread) => thread.thread)
  const ready = await remoteReady(remote)
  if ("kind" in ready) {
    const notSetUp = ready.error.code === "host_unavailable" && remoteNotSetUp(ready.error.details?.["state"])
    const listed = !allScope && notSetUp ? local : { ...local, remote_unavailable: ready.error.code }
    // The registry is asked only while the account's other devices can be reached (#12833): not while the device service is
    // not connected, nor on a plan without a relay (plan_required). A row's missing alias is then unknown, never "holds none" (#13923).
    return remote.aliases === undefined || ids.length === 0 ? listed : { ...listed, aliases_unavailable: "not_asked" }
  }
  const known = new Set(ids)
  const [here, hereName, listed, roster] = await Promise.all([
    // This device's id came with the relay state, in the same status round (#13414 U5).
    Promise.resolve(ready.here),
    remote.sessions.thisDeviceName?.().catch(() => null) ?? Promise.resolve(null),
    accountListing(remote).then(
      (listing) => ({ ok: true as const, listing }),
      () => ({ ok: false as const }),
    ),
    remote.sessions.devices().then(
      (devices) => ({ ok: true as const, devices }),
      () => ({ ok: false as const }),
    ),
  ])
  // Without this device's id its own rows cannot be told apart from another device's, so none are merged.
  if (!listed.ok || here === null) return withAliases(remote, { ...local, remote_unavailable: "host_unavailable" }, ids)
  const listing = listed.listing
  const others = listing.rows.filter((row) => row.device !== here && !known.has(rowThreadId(row)))
  // Every row names the machine that holds it (#14044 step 4a): this device's name on its own rows, the roster's name on
  // another device's.
  const machines = new Map(roster.ok ? roster.devices.map((device) => [device.device, device.label]) : [])
  const threads = [
    ...local.threads.map((thread) =>
      hereName === null || thread.machine !== undefined ? thread : { ...thread, machine: hereName },
    ),
    ...others.map((row) => threadRow(listedThread(row), machines.get(row.device))),
  ]
  // A roster that fails is said, never silently dropped: the threads stay merged and remote_unavailable names it.
  const merged: ThreadToolResult = {
    ...local,
    threads,
    ...(roster.ok
      ? { devices: deviceRows(roster.devices, { id: here, name: hereName }, listing.incomplete, threads) }
      : { remote_unavailable: "devices_unavailable" }),
  }
  return withAliases(remote, merged, [...ids, ...others.map(rowThreadId).filter((id) => id !== "")])
}

async function withAliases(
  remote: RemoteThreadSurface,
  listed: ThreadToolResult,
  ids: readonly string[],
): Promise<ThreadToolResult> {
  if (remote.aliases === undefined || listed.kind !== "ok" || !("threads" in listed) || ids.length === 0) return listed
  let aliases: Awaited<ReturnType<AliasRegistry["aliasesOf"]>>
  try {
    aliases = await remote.aliases.aliasesOf(ids)
  } catch {
    return { ...listed, aliases_unavailable: "host_unavailable" }
  }
  // Said, never silently dropped (#13923): a row without an alias then means "not read", never "holds none".
  if (aliases.kind === "error")
    return { ...listed, aliases_unavailable: signedOut(aliases.error) ? "sign_in" : "host_unavailable" }
  return {
    ...listed,
    threads: listed.threads.map((thread) => {
      const alias = aliases.value.get(thread.thread)
      return alias === undefined ? thread : { ...thread, alias }
    }),
  }
}
