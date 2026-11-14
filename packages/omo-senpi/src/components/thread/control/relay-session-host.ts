import type { ThreadSummary } from "../contracts"
import { rowThreadId } from "../remote/ports"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { INITIAL_SKILLS_CONTEXT_KEY } from "../initial-skills"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"
import { outcomeFailure } from "../remote/outcome"
import { deviceOnline, replyData } from "../remote/remote-ops"
import { prepareRemoteWorktree } from "../worktree/remote-worktree"
import { openedEngineId, openRefusal } from "./open-reply"
import { threadLink } from "../thread-link"
import { summary } from "../tools/internals"
import type { ThreadHostSession } from "../tools/ports"
import type { HostedThread, SessionHost, SessionOpenOutcome, SessionOpenRequest } from "./session-host"

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined
const recordOf = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {}

/** A listing row as the tools report a thread on another device (thread_list with all_scope shows the same). */
export function listedThread(row: RemoteSessionRow): HostedThread {
  const seen = new Date(row.updated_ms).toISOString()
  // D2 (decision 0027): the id a caller sees and may pass back is the durable id; the listing key stays inside sessionId
  // for the relay transport. A device that publishes no durable id lists an empty id: address its threads by name.
  return {
    sessionId: row.session_id,
    thread_id: rowThreadId(row),
    name: row.title,
    status: "live",
    cwd: row.project,
    created_at: seen,
    updated_at: seen,
    device: row.device,
    link: threadLink(rowThreadId(row), row.title),
  }
}

/**
 * Another device's engine endpoint as a SessionHost (#393's attach-less `open_session`): the device's live listing rows
 * are what is visible there; `open` sends one `open_session` to its endpoint, asks a create or fork for its new session's
 * listing key (decision 0018 amendment 2026-11-06; an older host is asked through `locate`), names the session when a
 * name was asked for, and reports the engine's reply state keyed by that listing id. `listed` is the row of the session
 * an open re-opens, which already names the id the device lists it by.
 */
export function createRelaySessionHost(
  remote: RemoteThreadSurface,
  device: string,
  listed?: RemoteSessionRow,
): SessionHost {
  const fail = (
    code: Parameters<typeof threadToolFailure>[0],
    message: string,
    next: string,
    details?: Readonly<Record<string, unknown>>,
  ): SessionOpenOutcome => ({ kind: "error", error: threadToolFailure(code, message, next, details) })
  return {
    device,
    visible: async (): Promise<readonly ThreadSummary[]> =>
      (await remote.sessions.sessions())
        .filter((row) => row.device === device && row.state !== "ended")
        .map(listedThread),
    open: async (request: SessionOpenRequest): Promise<SessionOpenOutcome> => {
      const offline = await deviceOnline(remote, device)
      if (offline !== undefined) return offline
      const { name, initialSkills, permissionPreset, worktree, ...asked } = request
      const made = worktree === undefined ? undefined : await prepareRemoteWorktree(remote, device, asked.cwd ?? "", worktree)
      if (made?.kind === "error") return made
      const open = made === undefined ? asked : { ...asked, cwd: made.worktree.path }
      const frame: JsonObject = {
        type: "open_session",
        retain_on_disconnect: true,
        ...open,
        ...(initialSkills === undefined || initialSkills.length === 0
          ? {}
          : { context: { [INITIAL_SKILLS_CONTEXT_KEY]: JSON.stringify(initialSkills) } }),
        ...(permissionPreset === undefined ? {} : { permissionPreset }),
      }
      const reopens = request.sessionPath !== undefined
      const outcome = await remote.sessions.endpointCommand(device, frame, reopens ? undefined : { locate: true })
      if (outcome.kind !== "ok") return openRefusal(outcome, device, open.cwd)
      const data = replyData(outcome.response)
      const state = recordOf(data["state"])
      let threadId: string
      const warnings: ThreadToolFailure[] = []
      if (reopens && listed !== undefined) threadId = listed.session_id
      else {
        const engineId = openedEngineId(data, state)
        if (engineId === undefined)
          return fail(
            "internal_error",
            `Device ${device} opened a session but did not name it.`,
            "Call thread_list with all_scope to find the new thread.",
            { device },
          )
        // The session exists on b from here on: a later step that fails is a warning on the created thread, never an
        // error, so a retry under the same key replays the thread and a new key cannot make a second session.
        const located = await remote.sessions.locate(device, engineId, outcome.located)
        if (located.kind !== "ok")
          warnings.push(
            threadToolFailure(
              "unsupported",
              `Device ${device} created the thread but did not name its relay key (${located.reason}).`,
              "Address it by thread_id once thread_list with all_scope lists it, or update omo on that device.",
              { device, reason: located.reason },
            ),
          )
        threadId = located.kind === "ok" ? located.sessionId : engineId
      }
      let applied = name
      if (name !== undefined) {
        const named = await remote.sessions.sessionCommand(device, threadId, {
          type: "set_session_name",
          sessionId: threadId,
          name,
        })
        if (named.kind !== "ok") {
          applied = undefined
          const failed = outcomeFailure(named, device).error
          warnings.push({ ...failed, details: { ...failed.details, reason: "name_not_applied", cause: failed.details?.["reason"] } })
        }
      }
      // The reply's state keyed by the id the device lists the session under; the far engine's own routing id and
      // endpoint facts name nothing on this device.
      const {
        sessionId: _engineId,
        durableSessionId: _durable,
        socket: _socket,
        endpoint_kind: _endpointKind,
        controls: _controls,
        ...facts
      } = state
      // D2: the id the caller gets back is the durable id, never the listing key, which stays in sessionId for the relay
      // transport. The engine's open reply names it as state.sessionId (data.sessionId is its routing id); a listed row
      // carries it too. Without it the caller would get the listing key, which no thread tool resolves.
      const durable =
        nonEmpty(state["durableSessionId"]) ??
        nonEmpty(data["durableSessionId"]) ??
        nonEmpty(state["sessionId"]) ??
        listed?.durable_id
      const session: ThreadHostSession = {
        ...facts,
        sessionId: threadId,
        ...(durable === undefined ? {} : { durableSessionId: durable }),
        cwd: nonEmpty(state["cwd"]) ?? open.cwd ?? listed?.project ?? "",
        name: applied ?? nonEmpty(state["sessionName"]) ?? listed?.title ?? null,
      }
      const extras = { ...(made === undefined ? {} : { worktree: made.worktree }), ...(warnings.length === 0 ? {} : { warnings }) }
      return { kind: "ok", thread: { ...summary(session), device, ...extras } }
    },
  }
}
