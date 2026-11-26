import { resolveAddress } from "../address"
import { toThreadAddressEntries, type AddressEntry } from "../address-book"
import { THREAD_READ_MAX_BYTES, type ThreadResultSummary, type ThreadState, type ThreadToolResult } from "../contracts"
import { listAcross } from "../remote/cross-device"
import { addressBook } from "../tools/internals"
import { UNKNOWN_CALLER } from "../tools/ports"
import { listThreads, readThread, withBacklog } from "../tools/read-ops"
import { locateControl } from "../control/locate"
import { NOT_LIVE } from "../control/operations"
import { controlIdentity, controlRefusalOf } from "../control/port"
import type { ThreadTranscriptEntry } from "../reader"
import { readBudget, takeWithinBudget } from "../read-budget"
import { readReceipt } from "../remote/lazy-ops"
import type { ThreadCoreContext } from "./context"
import { type Failure, fail } from "./failures"
import { unknownKeys } from "../contracts"

type Scoped = { readonly all_scope?: boolean }

/** Where a session lives right now, as `omo daemon adopt` needs it. */
export type LocatedThread = Pick<
  AddressEntry,
  "thread_id" | "title" | "cwd" | "status" | "session_path" | "endpoint" | "surface" | "alive"
> & {
  /** A thread on another device: its device id and the address every tool accepts (absent on this device). */
  readonly device?: string
  readonly address?: string
}

export type CoreListRequest = Scoped & {
  readonly state?: readonly ThreadState[]
  /** List as a caller in this workspace root would; `all_scope` widens past it as before. */
  readonly workspace?: string
  /** A device id, its name (case-insensitive), or `here` for this device. */
  readonly device?: string
  /** A thread's working directory, exactly. */
  readonly project?: string
  /** A thread's real name, case-insensitive. */
  readonly name?: string
  /** true: archived threads only; false: none of them. */
  readonly archived?: boolean
  readonly idempotency_key?: string
}
export type CoreReadRequest = Scoped & {
  readonly thread: string
  readonly max_bytes?: number
  readonly cursor?: string
  /** The newest `limit` items of the read page (`omo thread read --limit`). */
  readonly limit?: number
  readonly idempotency_key?: string
}

type ListedRow = { readonly state?: string; readonly device?: string; readonly machine?: string } & Record<
  string,
  unknown
>

const EVERY_STATE: readonly ThreadState[] = ["opening", "running", "idle", "inactive", "archived"]

/** The filters the remote module's listing has (R/client.ts), over the thread listing's rows (#14951). */
function filtered(result: ThreadToolResult, request: CoreListRequest): ThreadToolResult {
  if (result.kind !== "ok" || !("threads" in result)) return result
  const device = request.device?.toLowerCase()
  const name = request.name?.toLowerCase()
  const keep = (row: ThreadResultSummary) =>
    (device === undefined ||
      (device === "here"
        ? row.device === undefined
        : row.device?.toLowerCase() === device || row.machine?.toLowerCase() === device)) &&
    (request.project === undefined || row.cwd === request.project) &&
    // Only a real name is an address, so a name filter never matches a fallback (as the remote module's listing).
    (name === undefined || (row.unnamed !== true && row.name.toLowerCase() === name)) &&
    (request.archived === undefined || (row.state === "archived") === request.archived)
  return { ...result, threads: result.threads.filter(keep) }
}
export type CoreLocateResult = { readonly kind: "ok"; readonly thread: LocatedThread } | Failure

const LIST_KEYS = [
  "all_scope",
  "state",
  "workspace",
  "device",
  "project",
  "name",
  "archived",
  "idempotency_key",
] as const
const READ_KEYS = ["thread", "max_bytes", "cursor", "all_scope", "limit", "idempotency_key"] as const
const LOCATE_KEYS = ["thread", "all_scope"] as const
const RECEIPT_KEYS = ["thread", "delivery_id", "all_scope"] as const
const MESSAGES_KEYS = ["thread", "all_scope", "max_bytes"] as const

export type CoreReceiptRequest = Scoped & { readonly thread: string; readonly delivery_id: string }
export type CoreReadAfterWaitRequest = CoreReadRequest & { readonly wait_ms: number }
type CoreMessagesRequest = Scoped & { readonly thread: string; readonly max_bytes?: number }
export type CoreMessagesResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly device?: string
      /** The newest messages that fit `max_bytes`, oldest first. */
      readonly messages: readonly ThreadTranscriptEntry[]
      /** Older messages did not fit the budget; `total_items` counts them all. */
      readonly truncated: boolean
      readonly total_items: number
      readonly max_bytes: number
      /** The asked budget passed the cap, so the read took the cap (design lane ruling 4: clamped, never refused). */
      readonly clamped?: true
    }
  | Failure

/** The newest `limit` items of a read page; the page's cursor and budget are the read's own. */
function newest(result: ThreadToolResult, limit: number | undefined): ThreadToolResult {
  if (limit === undefined || result.kind !== "ok" || !("items" in result)) return result
  return { ...result, items: result.items.slice(Math.max(0, result.items.length - limit)) } as ThreadToolResult
}

export function createReads(context: ThreadCoreContext) {
  const { options, principal, store, surface, view, resolveContext, controls } = context
  const readOptions = () => ({ ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) })
  const list = (request: CoreListRequest = {}): Promise<ThreadToolResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, LIST_KEYS)
      if (refused !== undefined) return refused
      const { workspace } = request
      const scoped = workspace === undefined ? surface : { ...surface, callerWorkspaceRoot: () => workspace }
      // archived: true asks for rows the default states leave out; the filter then keeps only those.
      const states = request.archived === true && request.state === undefined ? EVERY_STATE : request.state
      return await context.keyed("thread_list", request, request.idempotency_key, async () =>
        filtered(
          await listAcross(
            options.remote,
            await withBacklog(surface.store, listThreads(scoped, await view(), request.all_scope, states)),
            request.all_scope === true,
            states,
          ),
          request,
        ),
      )
    })
  const read = (request: CoreReadRequest): Promise<ThreadToolResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, READ_KEYS)
      if (refused !== undefined) return refused
      return await context.keyed("thread_read", request, request.idempotency_key, async () =>
        newest(
          await readThread(
            readOptions(),
            await view(),
            {
              thread: request.thread,
              max_bytes: request.max_bytes,
              cursor: request.cursor,
              all_scope: request.all_scope,
            },
            UNKNOWN_CALLER,
          ),
          request.limit,
        ),
      )
    })
  const locate = (request: Scoped & { readonly thread: string }): Promise<CoreLocateResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, LOCATE_KEYS)
      if (refused !== undefined) return refused
      const current = await view()
      const resolved = await resolveAddress(
        resolveContext(toThreadAddressEntries(addressBook(surface, current))),
        request.thread,
        { all_scope: request.all_scope, probe: true },
      )
      if (resolved.kind === "error") return { kind: "error", error: resolved } as const
      // A thread on another device: the same located shape, carrying its device and the address every tool takes.
      if (resolved.where.kind === "device") {
        const { thread_id, name, cwd, status } = resolved.entry
        return {
          kind: "ok",
          thread: {
            thread_id,
            title: name,
            cwd,
            status,
            session_path: null,
            endpoint: null,
            surface: null,
            alive: status === "live",
            device: resolved.where.row.device,
            address: resolved.address,
          },
        } as const
      }
      const entries = addressBook(surface, current).filter((entry) => entry.thread_id === resolved.thread)
      const entry = entries.find((candidate) => candidate.alive) ?? entries[0]
      if (entry === undefined)
        return fail(
          "not_found",
          `Thread ${resolved.thread} is not in the address book.`,
          "Run omo thread list --all-scope.",
        )
      const { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive } = entry
      return {
        kind: "ok",
        thread: { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive },
      } as const
    })
  // thread_read's receipt branch for this script: the outcome of its own delivery to that exact thread, read before any
  // view (no conversation read, nothing sent, nothing woken). Its deliveries here carry `cli:<uid>`; those to another
  // device were the person's own prompt, so their retained receipt is keyed by `person:<uid>`.
  const receipt = (request: CoreReceiptRequest): Promise<ThreadToolResult> =>
    context.guard(
      async () =>
        unknownKeys(request, RECEIPT_KEYS) ??
        readReceipt(
          store,
          options.remote,
          `person:${options.uid}`,
          request.thread,
          request.delivery_id,
          (surface.now ?? store.now)(),
          principal,
        ),
    )
  // thread_read's wait branch: wait for the turn to end, then the same bounded read.
  const readAfterWait = (request: CoreReadAfterWaitRequest): Promise<ThreadToolResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, [...READ_KEYS, "wait_ms"])
      if (refused !== undefined) return refused
      return await context.keyed("thread_read", request, request.idempotency_key, async () =>
        newest(
          await readThread(
            readOptions(),
            await view(),
            {
              thread: request.thread,
              max_bytes: request.max_bytes,
              cursor: request.cursor,
              all_scope: request.all_scope,
              wait_ms: request.wait_ms,
            },
            UNKNOWN_CALLER,
          ),
          request.limit,
        ),
      )
    })
  // The engine's message list for a live thread, wherever it is held (no tool has it: a session reads the bounded
  // transcript), cut to the read's own byte budget from the newest message back, as thread_read's first read is; a thread
  // no engine holds answers as every control does.
  const messages = (request: CoreMessagesRequest): Promise<CoreMessagesResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, MESSAGES_KEYS)
      if (refused !== undefined) return refused
      const asked = request.max_bytes
      const clamped = asked !== undefined && Number.isSafeInteger(asked) && asked > THREAD_READ_MAX_BYTES
      const budget = readBudget(clamped ? THREAD_READ_MAX_BYTES : asked)
      if (budget.kind === "error") return budget
      const located = await locateControl(controls, await view(), request.thread, request.all_scope, UNKNOWN_CALLER)
      if (located.kind === "error") return located.result as Failure
      if (located.kind === "not_live") return NOT_LIVE as Failure
      try {
        const all = await located.control.getMessages()
        const { selected } = takeWithinBudget(all, budget.maxBytes, "end")
        return {
          kind: "ok",
          ...controlIdentity(located.control),
          messages: selected,
          truncated: selected.length < all.length,
          total_items: all.length,
          max_bytes: budget.maxBytes,
          ...(clamped ? { clamped: true as const } : {}),
        }
      } catch (error) {
        // A control's typed refusal (another device's answer included) is the call's answer, as in every control.
        const refusal = controlRefusalOf(error)
        if (refusal === undefined) throw error
        return { kind: "error", error: refusal }
      }
    })
  return { list, read, locate, receipt, readAfterWait, messages }
}
