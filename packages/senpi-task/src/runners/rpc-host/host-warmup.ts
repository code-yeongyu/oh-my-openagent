import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { askHost, isRecord, type HostReply } from "./host-request"
import { HOST_WARMUP_CONTEXT } from "./session-role"
import { HostSessionClient, type HostSessionClientPorts } from "./session-client"

/**
 * Warms a freshly started task host for the child sessions it is about to open.
 *
 * A host pays for its FIRST session: the extension graph is compiled and every lazily imported
 * runtime (the task engine among them) loads then, which made a pre-warmed shard's first child
 * ~0.8 s slower to open than the second one. The host's `warm` command (senpi#2314) builds exactly
 * what an `open_session` with the same cwd, kind and context builds - without a session, a
 * `session_start`, or an attachment that would hold the host from its idle exit. The profile is a
 * child's (`worker` kind, `child` role), so it loads what a child loads; a private temp `state_dir`
 * keeps it away from every real task store, and `host_warmup` lets extensions that report sessions
 * (telemetry) leave it out.
 *
 * An engine from before the command (or a registry that cannot warm) gets the older warm-up: one
 * throwaway child-shaped session, opened and closed at once, never retained. Nothing survives
 * either path: the temp directory is removed.
 */

export interface WarmHostSessionInput {
  readonly socket: string
  readonly cwd: string
  readonly ports?: HostSessionClientPorts
  /** Where the throwaway state directory is created; the OS temp dir by default. */
  readonly tempRoot?: string
}

export const HOST_WARMUP_TASK_ID = "host-warmup"

/** What warmed the host: its `warm` command, or the warm-up session an older engine needed. */
export type TaskHostWarmth = "warmed" | "already_warm" | "warm_up_session"

/** The host knows `warm` and refused it (draining, a failed load), or never answered. */
export class HostWarmRefusedError extends Error {
  override readonly name = "HostWarmRefusedError"
  readonly socket: string
  readonly code: string

  constructor(socket: string, code: string) {
    super(`host warm refused on ${socket}: ${code}`)
    this.socket = socket
    this.code = code
  }
}

const WARM_REQUEST_ID = "omo-task-host-warm"
// The first load compiles the extension graph; a loaded host answers in well under a second.
const WARM_TIMEOUT_MS = 60_000
// What an engine that KNOWS `warm` refuses it with. Any other refusal (`missing_session_id` from a
// router that reads an unknown session-less command as a session command) is an engine from before it.
const WARM_REFUSALS = ["host_draining", "warm_failed", "invalid_session_kind", "invalid_session_context", "invalid_path"] as const

type WarmAnswer =
  | { readonly kind: "warm"; readonly state: "warmed" | "already_warm" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "refused"; readonly code: string }

export async function warmTaskHost(input: WarmHostSessionInput): Promise<TaskHostWarmth> {
  const stateDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), "omo-host-warmup-"))
  const context = { role: "child", task_id: HOST_WARMUP_TASK_ID, state_dir: stateDir, [HOST_WARMUP_CONTEXT]: "1" }
  try {
    const request = { id: WARM_REQUEST_ID, type: "warm", cwd: input.cwd, kind: "worker", context }
    const answer = classifyWarmReply(await askHost(input.socket, request, WARM_TIMEOUT_MS))
    switch (answer.kind) {
      case "warm":
        return answer.state
      case "refused":
        throw new HostWarmRefusedError(input.socket, answer.code)
      case "unsupported":
        await openAndCloseWarmUpSession(input, stateDir, context)
        return "warm_up_session"
      default:
        return assertNever(answer)
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
}

function classifyWarmReply(reply: HostReply | undefined): WarmAnswer {
  if (reply === undefined) return { kind: "refused", code: "no_answer" }
  if (reply.success === true) {
    const state = isRecord(reply.data) ? reply.data.state : undefined
    return state === "warmed" || state === "already_warm" ? { kind: "warm", state } : { kind: "unsupported" }
  }
  const error = typeof reply.error === "string" ? reply.error : ""
  const known = WARM_REFUSALS.some((code) => error === code || error.startsWith(`${code}:`))
  return known ? { kind: "refused", code: error } : { kind: "unsupported" }
}

async function openAndCloseWarmUpSession(
  input: WarmHostSessionInput,
  stateDir: string,
  context: Readonly<Record<string, string>>,
): Promise<void> {
  const client = new HostSessionClient({ socketPath: input.socket, ...(input.ports === undefined ? {} : { ports: input.ports }) })
  try {
    await client.open({
      sessionPath: join(stateDir, "warmup.jsonl"),
      cwd: input.cwd,
      kind: "worker",
      context,
      retainOnDisconnect: false,
      autoTitle: false,
    })
    await client.close()
  } finally {
    // A failed open or close leaves no connection behind: the session is not retained, so the host
    // closes it once this connection drops.
    await client.detach().catch(() => undefined)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled warm answer: ${JSON.stringify(value)}`)
}
