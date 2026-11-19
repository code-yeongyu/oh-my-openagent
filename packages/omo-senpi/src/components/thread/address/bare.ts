import { devicesSilent, THREAD_ID_SHAPE } from "@oh-my-opencode/thread-address-core"
import { fuzzyContenders, type ThreadAddressEntry } from "../addressing"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { relayAddressEntry } from "../remote/address-book"
import type { RemoteThreadSurface } from "../remote/ports"
import { holderTarget } from "../remote/remote-ops"
import type { Account, AccountRead } from "./account"
import { ladder, type LadderResult } from "./ladder"
import { probeAcross } from "./probe"
import { asRefusal, toolRefusal, withAddresses, type ThreadRefusal } from "./refusals"
import type { Found, ResolveContext, ResolveOptions } from "./types"

/** An account read, or the error it threw (a listing that could not be reached). */
export type AccountAttempt = AccountRead | { readonly kind: "failed"; readonly error: unknown }

type Book = {
  readonly entries: readonly ThreadAddressEntry[]
  readonly account?: Account
  /** A configured relay's connection failure or plan refusal; absent remote setup contributes no entries. */
  readonly unavailable?: ThreadToolFailure
  /** The alias named a holder the account cannot reach right now (device_offline / not_found): answered as is. */
  readonly aliasFailure?: ThreadToolFailure
}

export const deviceNameOf =
  (account: Account | undefined) =>
  (device: string): string | undefined =>
    account?.devices.find((row) => row.device === device)?.label

/**
 * The account's threads on OTHER devices as address entries, plus the holder of `text` when it is an account alias (the
 * registry resolves one alias at a time). A holder on this device becomes a local entry carrying the alias; a holder
 * elsewhere is its listing row on that device.
 */
async function accountBook(remote: RemoteThreadSurface, text: string, read: AccountAttempt): Promise<Book> {
  if (read.kind === "failed")
    return {
      entries: [],
      unavailable: threadToolFailure(
        "host_unavailable",
        "The account's session listing could not be reached.",
        "Retry when the device service is reachable.",
        { reason: read.error instanceof Error ? read.error.message : String(read.error) },
      ),
    }
  if (read.kind === "none") return { entries: [] }
  if (read.kind === "unavailable") return { entries: [], unavailable: read.error }
  const account = read.account
  const entries = account.rows.filter((row) => row.device !== account.here).map((row) => relayAddressEntry(row))
  const book = { entries, account }
  if (remote.aliases === undefined) return book
  const alias = await remote.aliases.resolve(text).catch(() => undefined)
  if (alias === undefined || alias.kind === "error") return book
  const holder = await holderTarget(remote, alias.value, account.here, account.rows, account.roster)
  if (!("where" in holder)) return { ...book, aliasFailure: holder.error }
  if (holder.where === "here")
    return {
      ...book,
      entries: [
        ...entries,
        { thread_id: holder.session_id, name: text, status: "live", cwd: "", created_at: "", updated_at: null, aliases: [text] },
      ],
    }
  if (holder.where !== "remote") return book
  const row = holder.row
  return { ...book, entries: [...entries.filter((entry) => entry.transport?.row !== row), relayAddressEntry(row, [text])] }
}

const found = (hit: Extract<LadderResult, { readonly kind: "ok" }>, allScope: boolean | undefined): Found => ({
  ...hit,
  all_scope: hit.resolution === "alias" || hit.entry.transport !== undefined ? true : allScope,
})

/**
 * A bare address over this device's book and the account's (decision 0027: one resolver). A local id hit never reads the
 * account. A configured relay's failure, plan refusal or alias holder's typed failure answers before not_found; a thread
 * id nothing lists gets the per-device probe; a miss while a device did not answer this listing round is
 * host_unavailable naming it (the remembered device when the memory has one), never not_found. No relay set up: a local
 * miss stays a local not_found.
 */
export async function resolveBare(
  ctx: ResolveContext,
  text: string,
  opts: ResolveOptions,
  read: () => Promise<AccountAttempt>,
): Promise<{ readonly result: Found | ThreadRefusal; readonly account?: Account }> {
  if (opts.match === "fuzzy" && opts.all_scope !== true && ctx.callerWorkspaceRoot.trim() === "")
    return {
      result: asRefusal(
        threadToolFailure(
          "caller_context_missing",
          "Scoping a fuzzy handoff needs the caller's workspace root, which this call did not provide.",
          "Set all_scope to search every workspace, or hand off from a session that knows its workspace.",
        ),
      ),
    }
  const here = ladder(ctx, ctx.local, text, opts)
  const exactHere = here.kind === "ok" && here.resolution !== "alias" && here.resolution !== "name" && here.resolution !== "id_prefix"
  if (here.kind === "ok" && (ctx.remote === undefined || exactHere)) return { result: found(here, opts.all_scope) }
  if (ctx.remote === undefined)
    return { result: here.kind === "ok" ? found(here, opts.all_scope) : withAddresses(here, null, () => undefined) }
  const book = await accountBook(ctx.remote, text, await read())
  const account = book.account
  if (book.entries.length === 0 && here.kind === "ok") return { result: found(here, opts.all_scope), account }
  // An ended session on another device is resumable: the exact ladder sees every row; fuzzy ranks only the ended rows
  // that can contend, so a large account's history cannot push a unique match over the 500-candidate cap.
  const all = [...ctx.local, ...book.entries]
  const ranked =
    opts.match === "fuzzy"
      ? [
          ...ctx.local,
          ...book.entries.filter((entry) => entry.status === "live"),
          ...fuzzyContenders(
            book.entries.filter((entry) => entry.status !== "live"),
            text,
          ),
        ]
      : all
  const across = ladder(ctx, all, text, opts, ranked)
  if (across.kind === "ok") return { result: found(across, opts.all_scope), account }
  if (book.aliasFailure !== undefined) return { result: asRefusal(book.aliasFailure), account }
  const missedHere = here.kind === "error" && here.code === "not_found"
  if (book.unavailable !== undefined && missedHere) return { result: asRefusal(book.unavailable), account }
  if (opts.probe === true && across.code === "not_found" && THREAD_ID_SHAPE.test(text)) {
    const looked = await probeAcross(ctx.remote, text, account?.roster, account?.here ?? null)
    if (looked !== undefined) return { result: looked, account }
  }
  const silent = account === undefined || !missedHere || across.code !== "not_found" ? [] : silentDevices(account, text)
  if (account !== undefined && silent.length > 0)
    return {
      result: toolRefusal(
        devicesSilent(
          "listing_incomplete",
          silent.map((id) => ({ id, name: deviceNameOf(account)(id) ?? id })),
        ),
      ),
      account,
    }
  return { result: withAddresses(across, account?.here ?? null, deviceNameOf(account)), account }
}

/** The devices a miss cannot rule out: the one an earlier round listed `text` on, else every device this round missed. */
function silentDevices(account: Account, text: string): readonly string[] {
  const remembered = account.missedHolder(text)
  if (remembered !== undefined) return [remembered]
  return [...new Set(account.incomplete)].filter(
    (device) => device !== account.here && account.listingOf(device) === "incomplete",
  )
}
