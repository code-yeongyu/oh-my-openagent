import { createHash } from "node:crypto"
import type { ThreadDataError, ThreadSummary } from "../contracts"
import type { ThreadToolFailure } from "../errors"
import { summary, type ThreadToolSummary } from "../tools/internals"
import type { ThreadHostSession } from "../tools/ports"
import type { ThreadWorktree, WorktreeRequest } from "../worktree/thread-worktree"

/**
 * One `open_session` as thread_create asks for it, on whichever device the host stands for: a new session (`cwd`),
 * an existing session's file (`sessionPath`), or a fork (`forkFrom`); `initialSkills` ride on the frame's context and
 * `permissionPreset` is the approval mode the new session starts in (its creator's, or one it narrowed to);
 * `provider` + `modelId` and `thinkingLevel` are the engine's launch profile (a model it cannot resolve refuses the open
 * with `model_unavailable`). Every field crosses the wire unchanged on both legs.
 */
export type SessionOpenRequest = {
  readonly cwd?: string
  readonly sessionPath?: string
  readonly forkFrom?: string
  readonly name?: string
  readonly initialSkills?: readonly string[]
  readonly permissionPreset?: string
  readonly provider?: string
  readonly modelId?: string
  readonly thinkingLevel?: string
  /** A new git worktree to create from the repository at `cwd` on the opening device; the session starts in it. */
  readonly worktree?: WorktreeRequest
  /** The id a new session is created under (`createdThreadId`); a host without `durable_session_id` ignores it. */
  readonly durableSessionId?: string
}

/**
 * The id thread_create creates a thread on this device under (#14060): derived from the caller and the call's
 * idempotency key, UUID-shaped (version 8), so a create whose reply was lost, and a retry under the same key, find the
 * thread it made instead of making another.
 */
export function createdThreadId(callerId: string, idempotencyKey: string): string {
  const hex = createHash("sha256").update(`thread_create\0${callerId}\0${idempotencyKey}`).digest("hex")
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** A thread as the tools report it, with `device` when it is on another of the account's devices. */
/** `warnings`: steps after the session was created that failed; the thread exists and is answered anyway. */
export type HostedThread = ThreadToolSummary & {
  readonly device?: string
  /** A row from another device's cached listing: when that listing was taken. */
  readonly as_of?: string
  readonly worktree?: ThreadWorktree
  readonly warnings?: readonly ThreadToolFailure[]
}

/**
 * The one thread thread_create answers on every device: the opened session's identity, folder, name, state and times
 * through `summary()`, never the rest of the engine's reply state (its lifecycle, holds, questions, endpoint facts).
 */
export function openedThread(session: ThreadHostSession): ThreadToolSummary {
  const { sessionId, durableSessionId, cwd, name, status, createdAt, updatedAt, created_at, updated_at } = session
  return summary({
    sessionId,
    cwd,
    ...(durableSessionId === undefined ? {} : { durableSessionId }),
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(created_at === undefined ? {} : { created_at }),
    ...(updated_at === undefined ? {} : { updated_at }),
  })
}

/** The engine's reply state as the tools report a thread (`openedThread()`), with `device` when it is not this device's. */
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
