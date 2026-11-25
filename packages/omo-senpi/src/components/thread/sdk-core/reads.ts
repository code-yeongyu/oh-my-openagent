import { resolveAddress } from "../address"
import { toThreadAddressEntries, type AddressEntry } from "../address-book"
import type { ThreadState, ThreadToolResult } from "../contracts"
import { listAcross } from "../remote/cross-device"
import { addressBook } from "../tools/internals"
import { UNKNOWN_CALLER } from "../tools/ports"
import { listThreads, readThread, withBacklog } from "../tools/read-ops"
import type { ThreadCoreContext } from "./context"
import { type Failure, fail, guarded } from "./failures"
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

export function createReads(context: ThreadCoreContext) {
  const { options, surface, view, resolveContext } = context
  const list = (request: CoreListRequest = {}): Promise<ThreadToolResult> =>
    guarded(
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
    guarded(
      async () =>
        unknownKeys(request, READ_KEYS) ??
        readThread(
          { ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) },
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
    guarded(async () => {
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
  return { list, read, locate }
}
