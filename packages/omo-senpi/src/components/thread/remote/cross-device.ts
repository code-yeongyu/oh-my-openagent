import { mergeRows, rowKey, type DeviceListing } from "@oh-my-opencode/thread-address-core"
import type { ThreadDevice, ThreadState, ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { displayedThread } from "../control/relay-session-host"
import { threadRow } from "../tools/thread-row"
import { listedStates } from "../tools/thread-state"
import { type AliasRegistry, type RemoteDevice, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
import { rememberListed, remoteNotSetUp } from "./address-book"
import { readAccount } from "../address/account"
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
        "Create the thread without fork_from and hand it the source's context with thread_send; thread_read reads the source (tool.thread_send() and tool.thread_read() in an eval cell).",
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

// `threads` counts the threads THIS result lists on the device, so it reads the same for every row: this device's are
// the caller's scoped local threads, another device's are its rows merged into the result. `listing` is the one
// per-device state the resolver reads too (design section 6).
function deviceRows(
  roster: readonly RemoteDevice[],
  self: { readonly id: string | null; readonly name: string | null },
  listingOf: (device: string) => DeviceListing,
  threads: readonly { readonly device?: string }[],
  local: { readonly dropped?: number; readonly incomplete: boolean },
): readonly ThreadDevice[] {
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
      // This device's threads come from its own endpoints, whose answers say whether it listed them in full.
      listing: thisDevice ? (local.incomplete ? "incomplete" : "listed") : listingOf(row.device),
      threads: threads.filter((thread) => (thread.device ?? self.id) === row.device).length,
      ...(thisDevice && local.dropped !== undefined ? { dropped: local.dropped } : {}),
    }
  })
}

/**
 * thread_list: this device's threads (scoped by `all_scope` as before) merged with the account's other devices' threads
 * (each with its device, any workspace), with aliases, and the account's devices with their listing state. A device
 * whose rows this listing could not include is named `incomplete` in `devices`, never silently left out. `states` filters
 * the other devices' rows as `listThreads` filters this device's (the default leaves archived threads out), and a device
 * counts only the threads listed. The order is design section 6's: read (one account read) -> identity (`rowKey`) ->
 * merge (`mergeRows`) -> name (`rowName`) -> state -> filter; nothing of another device is capped.
 */
export async function listAcross(
  remote: RemoteThreadSurface | undefined,
  local: ThreadToolResult,
  allScope: boolean,
  states?: readonly ThreadState[],
): Promise<ThreadToolResult> {
  if (remote === undefined || local.kind !== "ok" || !("threads" in local)) return local
  const ids = local.threads.map((thread) => thread.thread)
  const status = remoteReady(remote)
  const ready = await status
  if ("kind" in ready) {
    const notSetUp = ready.error.code === "host_unavailable" && remoteNotSetUp(ready.error.details?.["state"])
    const listed = !allScope && notSetUp ? local : { ...local, remote_unavailable: ready.error.code }
    // The registry is asked only while the account's other devices can be reached (#12833): not while the device service is
    // not connected, nor on a plan without a relay (plan_required). A row's missing alias is then unknown, never "holds none" (#13923).
    return remote.aliases === undefined || ids.length === 0 ? listed : { ...listed, aliases_unavailable: "not_asked" }
  }
  // The roster is the sessions port's, which lists each device's platform and kind; readAccount judges rows by it.
  const [hereName, roster] = await Promise.all([
    remote.sessions.thisDeviceName?.().catch(() => null) ?? Promise.resolve(null),
    remote.sessions.devices().then(
      (devices) => ({ ok: true as const, devices }),
      () => ({ ok: false as const }),
    ),
  ])
  const read = await readAccount(remote, { ready: status, roster: roster.ok ? roster.devices : undefined }).catch(
    () => undefined,
  )
  // Without this device's id its own rows cannot be told apart from another device's, so none are merged.
  if (read?.kind !== "account" || read.account.here === null)
    return withAliases(remote, { ...local, remote_unavailable: "host_unavailable" }, ids)
  const account = read.account
  const here = read.account.here
  // relayAddressBook (until the removal unit deletes it with its memory) ties a thread to the device an earlier round
  // listed it on (#14172): this round is such a round.
  rememberListed(remote.sessions, account.rows)
  // A device the account no longer lists contributes no rows (#13505, readAccount); an offline one keeps its rows.
  const merged = mergeRows<{ readonly key: string; readonly device: string; readonly row?: RemoteSessionRow }>(
    ids.map((key) => ({ key, device: here })),
    account.rows.map((row) => ({ key: rowKey(row), device: row.device, row })),
    here,
  )
  const shown = listedStates(states)
  // Every row names the machine that holds it (#14044 step 4a): this device's name on its own rows, the roster's name on
  // another device's.
  const machines = new Map(roster.ok ? roster.devices.map((device) => [device.device, device.label]) : [])
  const others = merged
    .flatMap((entry) => (entry.row === undefined ? [] : [entry.row]))
    .map((row) => ({ row, thread: threadRow(displayedThread(row), machines.get(row.device)) }))
    .filter(({ thread }) => shown.has(thread.state))
  const threads = [
    ...local.threads.map((thread) =>
      hereName === null || thread.machine !== undefined ? thread : { ...thread, machine: hereName },
    ),
    ...others.map(({ thread }) => thread),
  ]
  // A roster that fails is said, never silently dropped: the threads stay merged and remote_unavailable names it.
  const listed: ThreadToolResult = {
    ...local,
    threads,
    ...(roster.ok
      ? {
          devices: deviceRows(roster.devices, { id: here, name: hereName }, account.listingOf, threads, {
            dropped: local.inactive_dropped,
            incomplete: local.listing === "incomplete",
          }),
        }
      : { remote_unavailable: "devices_unavailable" }),
  }
  // Aliases are held by thread id: a row whose device publishes none holds no alias.
  const aliased = others.flatMap(({ row }) => (row.durable_id === undefined ? [] : [row.durable_id]))
  return withAliases(remote, listed, [...ids, ...aliased])
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
