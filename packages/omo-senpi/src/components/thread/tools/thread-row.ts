import type { ThreadResultSummary, ThreadState, ThreadSummary, ThreadToolResult } from "../contracts"
import type { ThreadToolFailure } from "../errors"
import type { ThreadWorktree } from "../worktree/thread-worktree"
import { threadLink } from "../thread-link"

type RowSource = Pick<ThreadSummary, "thread_id" | "name" | "status" | "cwd" | "created_at" | "updated_at"> &
  Pick<ThreadResultSummary, "state"> &
  Partial<
    Pick<
      ThreadResultSummary,
      | "model"
      | "activity"
      | "error_code"
      | "turn_id"
      | "as_of"
      | "device"
      | "alias"
      | "surface"
      | "controls"
      | "error_note"
      | "skills"
    >
  > & {
    readonly link: string
  }

/**
 * A thread as a tool result shows it (#14044 step 4a): `thread` is the address every thread tool takes back, and only
 * what a model acts on is kept. Routing ids, the durable id under another name, sockets, session paths and endpoint
 * internals stay in the address book.
 */
export function threadRow(thread: RowSource, machine?: string): ThreadResultSummary {
  const { model, activity, error_code, turn_id, as_of, device, alias, surface, controls, error_note, skills } = thread
  return {
    thread: thread.thread_id,
    name: thread.name,
    status: thread.status,
    state: thread.state,
    ...(model === undefined ? {} : { model: { provider: model.provider, id: model.id } }),
    ...(activity === undefined ? {} : { activity }),
    ...(error_code === undefined ? {} : { error_code }),
    ...(turn_id === undefined ? {} : { turn_id }),
    ...(as_of === undefined ? {} : { as_of }),
    ...(machine === undefined || machine === "" ? {} : { machine }),
    cwd: thread.cwd,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    link: thread.link,
    ...(device === undefined ? {} : { device }),
    ...(alias === undefined ? {} : { alias }),
    ...(surface === undefined || surface === null ? {} : { surface }),
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

type Loose = Record<string, unknown>
const isRecord = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** `value` with the key `from` renamed to `to` in place, so the field keeps its position. */
function renamed(value: Loose, from: string, to: string): Loose {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key === from ? to : key, child]))
}

/** A stored row's state: a build before #13469 stored `alive` and `status` only, never `state`. */
const storedState = (row: Loose): ThreadState =>
  row["status"] === "live" && row["alive"] !== false ? "idle" : "inactive"

/** A row a build before #14044 stored (`thread_id`, routing ids, endpoint internals) as today's row; a current row as is. */
function storedRow(row: Loose): Loose {
  const id = row["thread_id"]
  if (typeof row["thread"] === "string" && typeof row["state"] === "string") return row
  if (typeof row["thread"] === "string") {
    const { alive: _alive, ...rest } = row
    return { ...rest, state: storedState(row) }
  }
  if (typeof id !== "string") return row
  const name = typeof row["name"] === "string" ? row["name"] : ""
  const link = typeof row["link"] === "string" ? row["link"] : threadLink(id, name)
  return threadRow({ ...(row as unknown as RowSource), name, link, state: storedState(row) }) as unknown as Loose
}

function storedCandidates(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((candidate) =>
        isRecord(candidate) && "id" in candidate ? renamed(candidate, "id", "thread") : candidate,
      )
    : value
}

/**
 * A stored tool receipt in today's shape. Receipts live 30 days, so a retry under the same idempotency key can replay a
 * result a build before #14044 wrote: a nested `thread` object or `thread_id`, rows with routing ids and endpoint
 * internals, an endpoint kind on a delivery, candidates named `id`. Each is mapped to the shape a current call answers;
 * a current result comes back unchanged.
 */
export function currentResult(result: ThreadToolResult): ThreadToolResult {
  let value: Loose = { ...(result as unknown as Loose) }
  if (value["kind"] === "error") {
    const error = value["error"]
    if (!isRecord(error)) return result
    const details = error["details"]
    return {
      ...value,
      ...("candidates" in value ? { candidates: storedCandidates(value["candidates"]) } : {}),
      error: {
        ...error,
        ...(isRecord(details) && "candidates" in details
          ? { details: { ...details, candidates: storedCandidates(details["candidates"]) } }
          : {}),
      },
    } as unknown as ThreadToolResult
  }
  const nested = value["thread"]
  if (isRecord(nested)) {
    const { requested_skills, worktree, warnings } = nested
    const { thread: _thread, ...rest } = value
    const { kind, ...others } = rest
    value = {
      kind,
      ...storedRow(nested),
      ...(requested_skills === undefined ? {} : { requested_skills }),
      ...(worktree === undefined ? {} : { worktree }),
      ...(warnings === undefined ? {} : { warnings }),
      ...others,
    }
  } else if (typeof value["thread_id"] === "string" && value["thread"] === undefined) {
    value = renamed(value, "thread_id", "thread")
  }
  // A flat row result (thread_create, a resolved send) a build before #13469 stored carries no state.
  if (typeof value["thread"] === "string" && typeof value["status"] === "string") value = storedRow(value)
  if (Array.isArray(value["threads"]))
    value = { ...value, threads: value["threads"].map((row) => (isRecord(row) ? storedRow(row) : row)) }
  const { endpoint: _endpoint, ...withoutEndpoint } = value
  const prompt = withoutEndpoint["prompt"]
  if (isRecord(prompt) && "endpoint" in prompt) {
    const { endpoint: _promptEndpoint, ...rest } = prompt
    return { ...withoutEndpoint, prompt: rest } as unknown as ThreadToolResult
  }
  return withoutEndpoint as unknown as ThreadToolResult
}
