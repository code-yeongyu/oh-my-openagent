import type { AliasError, AliasRegistry, AliasResult } from "../thread/remote/ports"
import type { ClientCore, Outcome, RemoteClient } from "./client"
import { nextActionFor, type RemoteCode, remoteFailure } from "./codes"
import { DEADLINES, withinDeadline } from "./deadlines"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import type { Opts, RemoteFailure, ThreadHandle } from "./types"

const noServiceAccess = (): RemoteFailure =>
  remoteFailure(
    "unsupported",
    "This client was built without access to the account's alias registry.",
    "Address the thread by its id or name with sessions.resolve.",
    { details: { feature: "aliases", missing: "service_access" } },
  )

// The registry's codes onto the remote codes, as the thread tools map them (thread/remote/remote-ops.ts aliasFailure):
// only alias_taken is a remote code of its own. `alias_code` keeps the registry's code beside its details.
const ALIAS_CODES: Readonly<
  Record<AliasError["code"], { readonly code: RemoteCode; readonly next_action: string; readonly kind?: string }>
> = {
  alias_taken: { code: "alias_taken", next_action: "Choose another alias; the holder is named in details." },
  alias_invalid: {
    code: "invalid_arguments",
    next_action: "Use 1-64 visible characters that do not look like a session id.",
  },
  alias_not_found: { code: "not_found", next_action: "Call sessions.list for the current threads.", kind: "alias" },
  alias_registry_unavailable: { code: "host_unavailable", next_action: "Retry when the account service is reachable." },
}

const aliasFailure = (error: AliasError): RemoteFailure => {
  const mapped = ALIAS_CODES[error.code]
  return remoteFailure(mapped.code, error.message, mapped.next_action, {
    details: {
      ...error.details,
      ...(mapped.kind === undefined ? {} : { kind: mapped.kind }),
      alias_code: error.code,
    },
  })
}

const notASession = (): RemoteFailure =>
  remoteFailure(
    "invalid_arguments",
    "An alias is held by a session on a device; this address names neither.",
    "Call sessions.resolve for the thread's handle.",
  )

/** The alias members (unit U3 of #13414, design 4b): resolve, set and clear on the account's alias registry. */
export function aliasMembers(core: ClientCore): RemoteClient["aliases"] {
  const load = core.deps.aliasRegistry
  if (load === undefined)
    return {
      resolve: async () => noServiceAccess(),
      set: async () => noServiceAccess(),
      clear: async () => noServiceAccess(),
    }

  // Loaded on first use; a failed load is not kept, so the next call tries again.
  let registry: Promise<AliasRegistry> | undefined
  const loaded = async (): Promise<AliasResult<AliasRegistry>> => {
    try {
      return { kind: "ok", value: await (registry ??= load()) }
    } catch (error) {
      registry = undefined
      return {
        kind: "error",
        error: {
          code: "alias_registry_unavailable",
          message: `The account's alias registry could not be loaded: ${error instanceof Error ? error.message : String(error)}.`,
          details: { reason: "registry_unavailable" },
        },
      }
    }
  }

  // Every member runs under DEADLINES.aliases with no device-service connection; set and clear may change the account.
  const run = <T>(
    opts: Opts | undefined,
    mutating: boolean,
    body: (aliases: AliasRegistry) => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> =>
    withinDeadline(core.timers, opts, DEADLINES.aliases, mutating, async () => {
      const aliases = await loaded()
      return aliases.kind === "error" ? aliasFailure(aliases.error) : await body(aliases.value)
    })

  const sessionOf = (thread: ThreadHandle) => {
    const parsed = canonicalizeThreadHandle(thread, {})
    return parsed.kind === "ok" && parsed.value.target.kind === "device_session" ? parsed.value.target : undefined
  }

  // The registry holds a session by its durable id, as the thread tools do (cross-device.ts), never by its session key:
  // the listed row on the handle's device names it.
  const durableIdOf = async (
    target: { readonly device: string; readonly session: string },
    opts: Opts | undefined,
  ): Promise<Outcome<string>> => {
    const listed = await core.sessionsList({ device: target.device }, opts)
    if (listed.kind === "error") return listed
    const row = listed.value.rows.find((candidate) => {
      const listedAt = sessionOf(candidate.thread)
      return listedAt?.device === target.device && listedAt.session === target.session
    })
    if (row === undefined)
      return remoteFailure("not_found", "No listed session has that handle.", nextActionFor("not_found"), {
        details: { kind: "session" },
      })
    if (row.durable_id === undefined)
      return remoteFailure(
        "unsupported",
        "The session's device lists no durable id for it, and an alias is held by the durable id.",
        nextActionFor("unsupported"),
        { details: { feature: "aliases", reason: "no_durable_id" } },
      )
    return { kind: "ok", value: row.durable_id }
  }

  return {
    // The holder's durable id back to the handle of the row its device lists with it.
    resolve: async (alias, opts) =>
      run(opts, false, async (aliases) => {
        const holder = await aliases.resolve(alias)
        if (holder.kind === "error") return aliasFailure(holder.error)
        const { device, session_id: durableId } = holder.value
        const listed = await core.sessionsList({ device }, opts)
        if (listed.kind === "error") return listed
        const row = listed.value.rows.find((candidate) => candidate.durable_id === durableId)
        const session = row === undefined ? undefined : sessionOf(row.thread)
        return session === undefined
          ? remoteFailure("not_found", "No listed session holds that alias's durable id.", nextActionFor("not_found"), {
              details: { kind: "session", durable_id: durableId },
            })
          : { kind: "ok", value: handleOf(session.device, session.session) }
      }),
    // Claim when the thread holds no alias, else rename it (thread/remote/cross-device.ts renameAlias).
    set: async (thread, alias, opts) => {
      const target = sessionOf(thread)
      if (target === undefined) return notASession()
      return run(opts, true, async (aliases) => {
        const durable = await durableIdOf(target, opts)
        if (durable.kind === "error") return durable
        const current = await aliases.aliasesOf([durable.value])
        if (current.kind === "error") return aliasFailure(current.error)
        const from = current.value.get(durable.value)
        const idempotency_key = `aliases.set\u0000${thread}\u0000${alias}`
        const changed =
          from === undefined
            ? await aliases.claim({
                alias,
                holder: { session_id: durable.value, device: target.device },
                idempotency_key,
              })
            : await aliases.rename({ session_id: durable.value, from, to: alias, idempotency_key })
        return changed.kind === "error"
          ? aliasFailure(changed.error)
          : { kind: "ok", value: { alias: changed.value.alias } }
      })
    },
    clear: async (thread, opts) => {
      const target = sessionOf(thread)
      if (target === undefined) return notASession()
      return run(opts, true, async (aliases) => {
        const durable = await durableIdOf(target, opts)
        if (durable.kind === "error") return durable
        const current = await aliases.aliasesOf([durable.value])
        if (current.kind === "error") return aliasFailure(current.error)
        const alias = current.value.get(durable.value)
        if (alias === undefined) return { kind: "ok", value: { released: false } }
        const released = await aliases.release({ session_id: durable.value, alias })
        return released.kind === "error" ? aliasFailure(released.error) : { kind: "ok", value: released.value }
      })
    },
  }
}
