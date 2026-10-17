import { DAEMON_EXIT } from "./daemon-args.js"
import { parseArgs } from "./thread-args.js"

/**
 * `omo daemon adopt <session>`: take a session a host holds into this terminal. The session is found
 * through the thread address book (it must be alive on an `rpc_host` endpoint), the host hands it
 * over with senpi `release_session {reason:"takeover"}`, and the caller then resumes it here with
 * the interactive launch on `--session <path>` (a path; `--resume` is the picker).
 *
 * What the release takes out never vanishes: `dropped.deliveries` are gateway rows the new owner's
 * inbox drain applies again (nothing to do here), and `dropped.user_messages` - the user's queued
 * input an `--interrupt` took out - become this terminal's first prompts in their queued order, or,
 * when the release is refused after all, are printed so the user can send them again.
 */

const USAGE = "usage: omo daemon adopt <session-id|name> [--interrupt] [--force] [--json]"

function refusalMessage(code, errorData, interrupt) {
  const busy = errorData?.busy?.length ? ` (${errorData.busy.join(", ")})` : ""
  switch (code) {
    case "turn_active":
      return interrupt
        ? `turn_active: the session is still busy after the interrupt${busy}`
        : `turn_active: the session is running a turn or owes one${busy}; pass --interrupt to stop it and take the session`
    case "session_busy":
      return `session_busy: the host is still working on the session${busy}; retry when it is done`
    case "attached":
      return `attached: ${errorData?.attachments ?? "?"} client(s) - a Desktop thread or another client owns it; pass --force to take it anyway`
    case "host_draining":
      return "host_draining: the host is shutting down; retry once it has handed its sessions over"
    case "session_closing":
      return "session_closing: the host is already closing the session"
    case "release_unsupported":
      return "release_unsupported: the host cannot hand this session over (a worker session or one without a file)"
    case "release_failed":
      return `release_failed: ${errorData?.detail ?? "the host could not write the hand-over"}`
    case "unknown_session":
      return "unknown_session: the host no longer holds the session"
    default:
      return `${code}: ${errorData?.hint ?? "the host refused the release"}`
  }
}

function refusalExit(code) {
  if (code === "unknown_session" || code === "host_unavailable") return DAEMON_EXIT.notRunning
  if (code === "release_failed" || code === "internal_error") return DAEMON_EXIT.engineRefused
  return DAEMON_EXIT.unsupported
}

function dropped(...replies) {
  const deliveries = []
  const userMessages = []
  for (const reply of replies) {
    const value = reply?.success === true ? reply.data.dropped : reply?.errorData?.dropped
    deliveries.push(...(value?.deliveries ?? []))
    userMessages.push(...(value?.user_messages ?? []).filter((message) => message.trim() !== ""))
  }
  return { deliveries, user_messages: userMessages }
}

/** `release_failed` is re-asked once: a teardown that got far enough answers `unknown_session`, which means the session is released. */
async function release(sdk, thread, request) {
  const first = await sdk.release(thread, request)
  if (first.success || first.error !== "release_failed") return { reply: first, dropped: dropped(first) }
  const second = await sdk.release(thread, {})
  if (second.success) return { reply: second, dropped: dropped(first, second) }
  if (second.error === "unknown_session" && thread.session_path !== null) {
    return { reply: { success: true, data: { released: true, session_path: thread.session_path, attachments: 0, dropped: dropped(first) } }, dropped: dropped(first) }
  }
  return { reply: first, dropped: dropped(first, second) }
}

/**
 * @returns an exit code, or `{ launch, cwd }`: the interactive launch arguments that resume the
 * released session in this terminal, and the directory it runs in.
 */
export async function runAdoptCommand(args, { sdk, stdout, stderr }) {
  // `--json` among the options, before `--`, is read before the parse: a usage error still answers in JSON.
  const end = args.indexOf("--")
  const json = (end === -1 ? args : args.slice(0, end)).includes("--json")
  const outcome = (payload, code) => {
    if (json) stdout.write(`${JSON.stringify(payload)}\n`)
    return code
  }
  const parsed = parseArgs(args, { booleans: ["--interrupt", "--force", "--json"] })
  if (parsed.error !== undefined || parsed.positionals.length !== 1) {
    stderr.write(`omo daemon adopt: ${parsed.error ?? "expects one session"}\n${USAGE}\n`)
    return outcome({ kind: "refused", error: "usage" }, DAEMON_EXIT.usage)
  }
  const interrupt = parsed.flags.has("--interrupt")

  const located = await sdk.locate({ thread: parsed.positionals[0], all_scope: true })
  if (located.kind !== "ok") {
    stderr.write(`omo daemon adopt: ${located.error.code}: ${located.error.message}\n`)
    return outcome({ kind: "refused", error: located.error.code }, located.error.code === "ambiguous_target" ? DAEMON_EXIT.usage : DAEMON_EXIT.notRunning)
  }
  const thread = located.thread
  if (thread.surface === "tui" || thread.endpoint?.kind === "tui") {
    stderr.write(`omo daemon adopt: ${thread.thread_id} is already a terminal session\n`)
    return outcome({ kind: "refused", error: "already_terminal", thread_id: thread.thread_id }, DAEMON_EXIT.unsupported)
  }
  if (!thread.alive || thread.endpoint === null) {
    stderr.write(`omo daemon adopt: no running host holds ${thread.thread_id}; resume it with omo --session ${thread.session_path ?? thread.thread_id}\n`)
    return outcome({ kind: "refused", error: "not_running", thread_id: thread.thread_id }, DAEMON_EXIT.notRunning)
  }

  const request = { ...(interrupt ? { interrupt: true } : {}), ...(parsed.flags.has("--force") ? { force: true } : {}) }
  const { reply, dropped: taken } = await release(sdk, thread, request)
  if (!reply.success) {
    stderr.write(`omo daemon adopt: ${refusalMessage(reply.error, reply.errorData, interrupt)}\n`)
    for (const message of taken.user_messages) stderr.write(`  queued message taken out by --interrupt, not delivered: ${message}\n`)
    return outcome({ kind: "refused", error: reply.error, thread_id: thread.thread_id, dropped: taken }, refusalExit(reply.error))
  }

  // senpi reads a leading `@` as a file argument even after `--`, so such a message is shown, not replayed.
  const replayable = taken.user_messages.filter((message) => !message.startsWith("@"))
  for (const message of taken.user_messages.filter((entry) => entry.startsWith("@"))) stderr.write(`  queued message not replayed (starts with @), send it again: ${message}\n`)
  const path = reply.data.session_path
  stderr.write(`omo daemon adopt: ${thread.thread_id} released from ${thread.endpoint.socket}; resuming it here${replayable.length > 0 ? ` with ${replayable.length} queued message(s)` : ""}\n`)
  // The relaunch carries them as argv, so they are also printed: a launch that fails after the release still leaves them on screen.
  for (const message of replayable) stderr.write(`  queued message taken out by --interrupt, replayed as a prompt: ${message}\n`)
  if (taken.deliveries.length > 0) stderr.write(`  ${taken.deliveries.length} gateway deliver${taken.deliveries.length === 1 ? "y returns" : "ies return"} to the session's inbox\n`)
  outcome({ kind: "released", thread_id: thread.thread_id, session_path: path, attachments: reply.data.attachments, dropped: taken }, DAEMON_EXIT.ok)
  return { launch: ["--session", path, ...(replayable.length > 0 ? ["--", ...replayable] : [])], cwd: thread.cwd }
}
