import { rowKey } from "@oh-my-opencode/thread-address-core"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import type { ThreadToolResult } from "../contracts"
import type { RemoteSessionRow } from "../remote/ports"
import { NOT_LIVE } from "./operations"
import { controlIdentity } from "./port"

/** A thread no engine holds live: its session file here, or an ended session on another device. */
export type NotLive = {
  readonly kind: "not_live"
  readonly thread_id: string
  readonly title: string
  readonly device?: string
  /** The ended row of a session another device holds; a read reopens it there (omo#14799). */
  readonly row?: RemoteSessionRow
}

/** An ended listing row is not live: a control answers for it without sending anything to its device. */
export const notLiveRow = (row: RemoteSessionRow): NotLive | undefined =>
  row.state === "ended"
    ? { kind: "not_live", thread_id: rowKey(row), title: escapeForDisplay(row.title), device: row.device, row }
    : undefined

/** What a control answers for a thread that is not live: a close has nothing to close, every other control NOT_LIVE. */
export const notLiveAnswer = (verb: "close" | "control", located: NotLive): ThreadToolResult =>
  verb === "close"
    ? { kind: "ok", ...controlIdentity(located), closed: false, reason: "not_live", dropped_deliveries: [] }
    : NOT_LIVE
