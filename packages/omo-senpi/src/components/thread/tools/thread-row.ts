import type { ThreadResultSummary, ThreadSummary, ThreadToolResult } from "../contracts"
import type { ThreadToolFailure } from "../errors"
import type { ThreadWorktree } from "../worktree/thread-worktree"

type RowSource = Pick<ThreadSummary, "thread_id" | "name" | "status" | "cwd" | "created_at" | "updated_at"> &
  Partial<
    Pick<ThreadResultSummary, "device" | "alias" | "surface" | "alive" | "controls" | "error_note" | "skills">
  > & {
    readonly link: string
  }

/**
 * A thread as a tool result shows it (#14044 step 4a): `thread` is the address every thread tool takes back, and only
 * what a model acts on is kept. Routing ids, the durable id under another name, sockets, session paths and endpoint
 * internals stay in the address book.
 */
export function threadRow(thread: RowSource, machine?: string): ThreadResultSummary {
  const { device, alias, surface, alive, controls, error_note, skills } = thread
  return {
    thread: thread.thread_id,
    name: thread.name,
    status: thread.status,
    ...(machine === undefined || machine === "" ? {} : { machine }),
    cwd: thread.cwd,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    link: thread.link,
    ...(device === undefined ? {} : { device }),
    ...(alias === undefined ? {} : { alias }),
    ...(surface === undefined || surface === null ? {} : { surface }),
    ...(alive === undefined ? {} : { alive }),
    ...(controls === undefined ? {} : { controls }),
    ...(error_note === undefined ? {} : { error_note }),
    ...(skills === undefined ? {} : { skills }),
  }
}

/** The `thread_create` answer for a session an open answered (or found live already): flat, `thread` first. */
export function openedResult(
  opened: RowSource & {
    readonly device?: string
    readonly worktree?: ThreadWorktree
    readonly warnings?: readonly ThreadToolFailure[]
  },
  deduplicated: boolean,
): ThreadToolResult {
  const { worktree, warnings } = opened
  return {
    kind: "ok",
    ...threadRow(opened),
    ...(worktree === undefined ? {} : { worktree }),
    ...(warnings === undefined ? {} : { warnings }),
    deduplicated,
  }
}
