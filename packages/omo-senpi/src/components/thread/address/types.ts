import type { ThreadAddressEntry, ThreadResolveOptions } from "../addressing"
import type { RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"
import type { DeviceRef } from "@oh-my-opencode/thread-address-core"

/** Who resolves, and against what: the account (absent = this device only), the caller's workspace and book, its id. */
export type ResolveContext = {
  readonly remote: RemoteThreadSurface | undefined
  readonly callerWorkspaceRoot: string
  /** This device's address book (live sessions and session files). */
  readonly local: readonly ThreadAddressEntry[]
  readonly callerId: string
}

/** The only knobs (design section 3). */
export type ResolveOptions = {
  readonly all_scope?: boolean
  /** `fuzzy`: a hand-off's ranking after the exact ladder misses. */
  readonly match?: "exact" | "fuzzy"
  readonly id_prefix?: ThreadResolveOptions["id_prefix"]
  /** Ask each reachable device for a thread id nothing lists (one probe per device). */
  readonly probe?: boolean
  /** An approved reply: resolve only `thread` on `device`, the device its delivery came from. */
  readonly pin?: { readonly device: string; readonly thread: string }
  /** `online`: a thread on a device that is offline is device_offline, nothing is queued. */
  readonly need?: "address" | "online"
}

export type Resolution = "self" | "id" | "session_id" | "alias" | "name" | "id_prefix" | "probe"

export type Resolved = {
  readonly kind: "ok"
  /** The thread id (empty for a session on another device that publishes none: see `address`). */
  readonly thread: string
  /** `<device id>/<thread id>` (or `<device id>/<listing key>`): accepted by every tool. The thread id alone with no account. */
  readonly address: string
  /** null: this device, with no account read. */
  readonly device: DeviceRef | null
  readonly where:
    | { readonly kind: "here"; readonly entry: ThreadAddressEntry }
    | { readonly kind: "device"; readonly row: RemoteSessionRow }
  /** The address book entry the thread resolved to, on either device. */
  readonly entry: ThreadAddressEntry
  readonly resolution: Resolution
  /** True when the thread was found through the account (an alias, another device): the workspace scope did not apply. */
  readonly all_scope: boolean | undefined
}

/** A ladder hit before it becomes a Resolved value. */
export type Found = {
  readonly kind: "ok"
  readonly entry: ThreadAddressEntry
  readonly resolution: Resolution
  readonly all_scope: boolean | undefined
}
