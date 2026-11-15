import type { ThreadDataError, ThreadSummary } from "../contracts"
import type { ThreadToolSummary } from "../tools/internals"

/**
 * One `open_session` as thread_create asks for it, on whichever device the host stands for: a new session (`cwd`),
 * an existing session's file (`sessionPath`), or a fork (`forkFrom`); `initialSkills` ride on the frame's context and
 * `permissionPreset` is the approval mode the new session starts in (its creator's). Every field crosses the wire
 * unchanged on both legs.
 */
export type SessionOpenRequest = {
  readonly cwd?: string
  readonly sessionPath?: string
  readonly forkFrom?: string
  readonly name?: string
  readonly initialSkills?: readonly string[]
  readonly permissionPreset?: string
}

/** A thread as the tools report it, with `device` when it is on another of the account's devices. */
export type HostedThread = ThreadToolSummary & { readonly device?: string }

/** The engine's reply state as the tools report a thread (`summary()`), with `device` when it is not this device's. */
export type SessionOpenOutcome = { readonly kind: "ok"; readonly thread: HostedThread } | ThreadDataError

/**
 * The port thread_create opens sessions through (#12884). Which device a create lands on is placement's business
 * (`planCreate`); past that point the tool body sees only this: the device's visible threads, which a new name must not
 * collide with, and one `open`. `LocalSessionHost` is this device's operator endpoint; `RelaySessionHost` is another
 * device's engine endpoint through the device service.
 */
export type SessionHost = {
  /** The device that opens; absent when it is this one. */
  readonly device?: string
  /** The threads visible on that device: this device's address book, or the account listing's live rows of that device. */
  readonly visible: () => Promise<readonly ThreadSummary[]>
  readonly open: (request: SessionOpenRequest) => Promise<SessionOpenOutcome>
}
