import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { listedThread } from "../control/relay-session-host"
import { rowThreadId, type AliasRegistry, type RemoteSessionRow, type RemoteThreadSurface } from "./ports"
import type { WorktreeRequest } from "../worktree/thread-worktree"
import { placeFolder } from "./create-folder"
import { aliasFailure, remoteAvailable } from "./remote-ops"
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
          source: plan.request.forkFrom,
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
    const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
    claimed = await remote.aliases.claim({
      alias,
      holder: { session_id: result.thread.thread_id, device: holderDevice },
      idempotency_key: `create:${result.thread.thread_id}`,
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
      error: { ...failed.error, details: { ...(failed.error.details ?? {}), thread_id: result.thread.thread_id } },
    }
  }
  return { ...result, thread: { ...result.thread, alias: claimed.value.alias } } as ThreadToolResult
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
  const holderDevice = device ?? (await remote.sessions.thisDevice()) ?? ""
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

/** thread_list with all_scope: this device's threads plus the account's other devices' (each with its device), with aliases. */
export async function listAcross(
  remote: RemoteThreadSurface | undefined,
  local: ThreadToolResult,
  allScope: boolean,
): Promise<ThreadToolResult> {
  if (remote === undefined || local.kind !== "ok" || !("threads" in local)) return local
  const ids = local.threads.map((thread) => thread.thread_id)
  const unavailable = await remoteAvailable(remote)
  if (!allScope) return unavailable === undefined ? withAliases(remote, local, ids) : local
  if (unavailable !== undefined) return { ...local, remote_unavailable: unavailable.error.code }
  const here = await remote.sessions.thisDevice()
  const known = new Set(ids)
  let listed: readonly RemoteSessionRow[]
  try {
    listed = await remote.sessions.sessions()
  } catch {
    return withAliases(remote, { ...local, remote_unavailable: "host_unavailable" }, ids)
  }
  const others = listed.filter((row) => row.device !== here && !known.has(rowThreadId(row)))
  const merged: ThreadToolResult = {
    ...local,
    threads: [
      ...local.threads,
      ...others.map((row) => {
        const { sessionId: _routing, ...thread } = listedThread(row)
        return thread
      }),
    ],
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
    return listed
  }
  if (aliases.kind === "error") return listed
  return {
    ...listed,
    threads: listed.threads.map((thread) => {
      const alias = aliases.value.get(thread.thread_id)
      return alias === undefined ? thread : { ...thread, alias }
    }),
  }
}
