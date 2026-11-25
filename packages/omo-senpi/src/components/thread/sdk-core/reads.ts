import { resolveAddress } from "../address"
import { toThreadAddressEntries, type AddressEntry } from "../address-book"
import type { ThreadState, ThreadToolResult } from "../contracts"
import { listAcross } from "../remote/cross-device"
import { addressBook } from "../tools/internals"
import { UNKNOWN_CALLER } from "../tools/ports"
import { listThreads, readThread, withBacklog } from "../tools/read-ops"
import { locateControl } from "../control/locate"
import { NOT_LIVE } from "../control/operations"
import { controlIdentity, controlRefusalOf } from "../control/port"
import type { ThreadTranscriptEntry } from "../reader"
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

export type CoreListRequest = Scoped & { readonly state?: readonly ThreadState[] }
export type CoreReadRequest = Scoped & {
  readonly thread: string
  readonly max_bytes?: number
  readonly cursor?: string
}
export type CoreLocateResult = { readonly kind: "ok"; readonly thread: LocatedThread } | Failure

const LIST_KEYS = ["all_scope", "state"] as const
const READ_KEYS = ["thread", "max_bytes", "cursor", "all_scope"] as const
const LOCATE_KEYS = ["thread", "all_scope"] as const
const RECEIPT_KEYS = ["thread", "delivery_id", "all_scope"] as const
const MESSAGES_KEYS = ["thread", "all_scope"] as const

export type CoreReceiptRequest = Scoped & { readonly thread: string; readonly delivery_id: string }
export type CoreReadAfterWaitRequest = CoreReadRequest & { readonly wait_ms: number }
export type CoreMessagesResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly device?: string
      readonly messages: readonly ThreadTranscriptEntry[]
    }
  | Failure

export function createReads(context: ThreadCoreContext) {
  const { options, principal, store, surface, view, resolveContext, controls } = context
  const readOptions = () => ({ ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) })
  const list = (request: CoreListRequest = {}): Promise<ThreadToolResult> =>
    context.guard(
      async () =>
        unknownKeys(request, LIST_KEYS) ??
        listAcross(
          options.remote,
          await withBacklog(surface.store, listThreads(surface, await view(), request.all_scope, request.state)),
          request.all_scope === true,
          request.state,
        ),
    )
  const read = (request: CoreReadRequest): Promise<ThreadToolResult> =>
    context.guard(
      async () =>
        unknownKeys(request, READ_KEYS) ??
        readThread(
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
    )
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
    context.guard(
      async () =>
        unknownKeys(request, [...READ_KEYS, "wait_ms"]) ??
        readThread(
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
    )
  // The engine's whole message list for a live thread, wherever it is held (no tool has it: a session reads the bounded
  // transcript); a thread no engine holds answers as every control does.
  const messages = (request: Scoped & { readonly thread: string }): Promise<CoreMessagesResult> =>
    context.guard(async () => {
      const refused = unknownKeys(request, MESSAGES_KEYS)
      if (refused !== undefined) return refused
      const located = await locateControl(controls, await view(), request.thread, request.all_scope, UNKNOWN_CALLER)
      if (located.kind === "error") return located.result as Failure
      if (located.kind === "not_live") return NOT_LIVE as Failure
      try {
        return { kind: "ok", ...controlIdentity(located.control), messages: await located.control.getMessages() }
      } catch (error) {
        // A control's typed refusal (another device's answer included) is the call's answer, as in every control.
        const refusal = controlRefusalOf(error)
        if (refusal === undefined) throw error
        return { kind: "error", error: refusal }
      }
    })
  return { list, read, locate, receipt, readAfterWait, messages }
}
