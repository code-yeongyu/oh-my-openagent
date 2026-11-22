import type { ThreadSummary } from "../contracts"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"
import { rowKey, rowName } from "@oh-my-opencode/thread-address-core"
import { rowFolder, rowStatus } from "../remote/ports"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { INITIAL_SKILLS_CONTEXT_KEY } from "../initial-skills"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "../remote/ports"
import { notSignedInFailure, outcomeFailure } from "../remote/outcome"
import { replyData } from "../remote/remote-ops"
import { resolveTypedDevice } from "../address/device"
import { prepareRemoteWorktree, removeRemoteWorktree } from "../worktree/remote-worktree"
import { openedEngineId, openRefusal } from "./open-reply"
import { threadLink } from "../thread-link"
import type { ThreadHostSession } from "../tools/ports"
import type { ThreadWorktree } from "../worktree/thread-worktree"
import { rowState, threadModel } from "../tools/thread-state"
import {
  openedThread,
  type HostedThread,
  type SessionHost,
  type SessionOpenOutcome,
  type SessionOpenRequest,
} from "./session-host"

/** The device service's own refusal: its route lists no such session, so nothing was dispatched to an engine. */
const ROUTE_UNLISTED = "route_unlisted"

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined
const recordOf = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {}

const remoteName = (text: string | undefined): string | null => (text === undefined ? null : escapeForDisplay(text))

/**
 * A listing row as the tools report a thread on another device (thread_list with all_scope shows the same): that
 * device's title and project are printed escaped (#13304), while matching keeps listedThread's raw values.
 */
export function displayedThread(row: RemoteSessionRow): HostedThread {
  const listed = listedThread(row)
  const name = escapeForDisplay(listed.name)
  return { ...listed, name, cwd: escapeForDisplay(listed.cwd), link: threadLink(listed.thread_id, name) }
}

function listedThread(row: RemoteSessionRow): HostedThread {
  const seen = new Date(row.updated_ms).toISOString()
  // Design section 6: the id a caller sees and may pass back is the row's key, its durable id, else
  // `<device id>/<listing key>` for a session whose device publishes none; the listing key stays inside sessionId for the
  // relay transport. Its name is the one naming function's: a session with none shows its folder's name, marked unnamed.
  const thread = rowKey(row)
  const { name, unnamed } = rowName({ name: row.title, folder: rowFolder(row) })
  return {
    sessionId: row.session_id,
    thread_id: thread,
    name,
    ...(unnamed ? { unnamed: true as const } : {}),
    status: rowStatus(row),
    state: rowState(row),
    ...threadModel(row.model),
    cwd: rowFolder(row),
    created_at: seen,
    updated_at: seen,
    device: row.device,
    ...(row.source === "cache" && row.as_of !== undefined ? { as_of: new Date(row.as_of).toISOString() } : {}),
    link: threadLink(thread, name),
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
  /**
   * A create whose new session b's route does not reach (#14394): end it on b through the endpoint that opened it, so
   * nothing is left behind, and refuse typed. `created` says whether a thread still exists there (the end failed).
   */
  const unreachable = async (
    reason: string,
    routingId: string | undefined,
    thread: string,
    worktree: ThreadWorktree | undefined,
  ): Promise<SessionOpenOutcome> => {
    const ended =
      routingId === undefined
        ? undefined
        : await remote.sessions.endpointCommand(device, {
            type: "unload_session",
            sessionId: routingId,
            force: true,
            children: "detach",
          })
    const created = !(ended?.kind === "ok" && replyData(ended.response)["outcome"] === "unloaded")
    // #14397 review M1: a worktree this call made on b for the session is removed with it; one b does not remove is
    // named in the answer, never covered by "nothing was left behind".
    const left = worktree === undefined ? undefined : await removeRemoteWorktree(remote, device, worktree)
    const shown = escapeForDisplay(reason)
    const session = created
      ? routingId === undefined
        ? `Device ${device} made thread ${thread}, but its route does not reach it (${shown}), and its open named no routing id to end it by: it is left with no live owner.`
        : `Device ${device} made thread ${thread}, but its route does not reach it (${shown}), and ending it there failed: it is left with no live owner.`
      : `Device ${device} took the open, but its route does not reach the session it made (${shown}): no thread host there that this account reaches takes new threads.`
    const remains =
      left !== undefined && worktree !== undefined
        ? ` The worktree ${worktree.path} made for it is still on that device.`
        : created
          ? ""
          : " Nothing was left behind."
    return fail(
      "host_unavailable",
      `${session}${remains}`,
      "Start omo on that device (an omo session, or omo daemon run), or create the thread on another device.",
      {
        device,
        reason: shown,
        created,
        ...(created ? { thread } : {}),
        ...(created && routingId === undefined ? { unload: "no_routing_id" } : {}),
        ...(left === undefined || worktree === undefined ? {} : { worktree, cleanup: left.error }),
      },
    )
  }
  return {
    device,
    visible: async (): Promise<readonly ThreadSummary[]> =>
      (await remote.sessions.sessions())
        .filter((row) => row.device === device && row.state !== "ended")
        .map(listedThread),
    open: async (request: SessionOpenRequest, options): Promise<SessionOpenOutcome> => {
      // The device resolved as the address module resolves one with need "online": unknown is not_found, offline is
      // device_offline (A3: nothing is queued for it), and a roster that cannot be read is host_unavailable.
      const resolved = await resolveTypedDevice(remote.client, device)
      if (resolved.kind === "error") return resolved
      // The host is for the device with this id: a name or id prefix that matched another device names no device here.
      if (resolved.device !== device)
        return fail(
          "not_found",
          `No device named ${device} is signed in to this account.`,
          "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to see the account's devices and threads.",
          { device },
        )
      const { name, initialSkills, permissionPreset, worktree, ...asked } = request
      const made =
        worktree === undefined ? undefined : await prepareRemoteWorktree(remote, device, asked.cwd ?? "", worktree)
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
      const outcome = await remote.sessions.endpointCommand(device, frame, { locate: true })
      if (outcome.kind !== "ok") {
        const model = request.provider === undefined ? undefined : `${request.provider}/${request.modelId ?? ""}`
        const refused = openRefusal(outcome, device, open.cwd, model)
        // A refused open ran nothing on b: undo the worktree this call made there. An uncertain one may have opened in
        // it, so the worktree stays and the failure names it.
        if (made === undefined) return refused
        const left = outcome.kind === "refused" ? await removeRemoteWorktree(remote, device, made.worktree) : undefined
        const keep =
          left === undefined && outcome.kind === "refused"
            ? {}
            : { worktree: made.worktree, ...(left === undefined ? {} : { cleanup: left.error }) }
        return { ...refused, error: { ...refused.error, details: { ...refused.error.details, ...keep } } }
      }
      const data = replyData(outcome.response)
      const state = recordOf(data["state"])
      let threadId: string
      const warnings: ThreadToolFailure[] = []
      if (reopens) {
        // #14170: a reopened session is addressed by the key its device lists it by NOW, never the cached row's key (a
        // closed session's key is gone, and every later op there answers not_resumable). It is answered ok only once
        // that key resolves; an open whose session cannot be reached is no resumed thread.
        const engineId = openedEngineId(data, state) ?? listed?.durable_id
        const located =
          engineId === undefined
            ? ({ kind: "refused", reason: "unnamed_session" } as const)
            : await remote.sessions.locate(device, engineId, outcome.located)
        if (located.kind !== "ok")
          return fail(
            "not_resumable",
            `Device ${device} opened the thread's file, but the reopened session cannot be reached there (${escapeForDisplay(located.reason)}).`,
            "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then open the thread by the id it lists.",
            { device, reason: escapeForDisplay(located.reason) },
          )
        threadId = located.sessionId
        if (listed !== undefined) remote.sessions.reopened?.(listed, located.sessionId)
      } else {
        const engineId = openedEngineId(data, state)
        if (engineId === undefined)
          return fail(
            "internal_error",
            `Device ${device} opened a session but did not name it.`,
            "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the new thread.",
            { device },
          )
        // The session exists on b from here on: a later step that fails is a warning on the created thread, never an
        // error, so a retry under the same key replays the thread and a new key cannot make a second session.
        const located = await remote.sessions.locate(device, engineId, outcome.located)
        // This device's own missing sign-in is no reason to update omo on b (#14015 review L1).
        if (located.kind !== "ok")
          warnings.push(
            notSignedInFailure(located.reason, device)?.error ??
              threadToolFailure(
                "unsupported",
                `Device ${device} created the thread but did not name its relay key (${escapeForDisplay(located.reason)}).`,
                "Address it by its thread value once thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) lists it, or update omo on that device.",
                { device, reason: escapeForDisplay(located.reason) },
              ),
          )
        threadId = located.kind === "ok" ? located.sessionId : engineId
      }
      let applied = name
      // The first command a create sends the new session through b's route: its name, else (a create that goes on to
      // use the session) the state read its first prompt would make anyway.
      const firstStep = (key: string) =>
        name !== undefined
          ? remote.sessions.sessionCommand(
              device,
              key,
              { type: "set_session_name", sessionId: key, name },
              { direct: true },
            )
          : !reopens && options?.confirmReach === true
            ? remote.sessions.sessionCommand(device, key, { type: "get_state", sessionId: key }, { direct: true })
            : undefined
      let reached = await firstStep(threadId)
      // #14394: every later step (its name, its first prompt, every tool) reaches the new session through b's route. A
      // route that does not list it (a host the service does not route, such as the Desktop app's) leaves an orphan
      // nothing can address: the create ends it where it was opened and refuses, before anything records the thread.
      // Only the service's own route_unlisted counts: an engine's answer about the key is no route verdict. A session b
      // opened a moment ago may not be routed yet (#14397 review L3), so one such refusal is not the verdict: b is asked
      // again where the session is, and only a second route_unlisted ends it.
      if (!reopens && reached?.kind === "refused" && reached.reason === ROUTE_UNLISTED) {
        const engineId = openedEngineId(data, state)
        const relocated = engineId === undefined ? undefined : await remote.sessions.locate(device, engineId)
        if (relocated?.kind === "ok") {
          threadId = relocated.sessionId
          reached = await firstStep(threadId)
        }
        if (reached?.kind === "refused" && reached.reason === ROUTE_UNLISTED)
          return await unreachable(
            reached.reason,
            nonEmpty(data["sessionId"]),
            nonEmpty(state["durableSessionId"]) ?? threadId,
            made?.worktree,
          )
      }
      const named = name === undefined ? undefined : reached
      if (named !== undefined) {
        if (named.kind !== "ok") {
          applied = undefined
          const failed = outcomeFailure(named, device).error
          warnings.push({
            ...failed,
            details: { ...failed.details, reason: "name_not_applied", cause: failed.details?.["reason"] },
          })
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
        cwd: escapeForDisplay(nonEmpty(state["cwd"]) ?? open.cwd ?? (listed === undefined ? "" : rowFolder(listed))),
        name: applied ?? remoteName(nonEmpty(state["sessionName"]) ?? listed?.title),
      }
      const extras = {
        ...(made === undefined ? {} : { worktree: made.worktree }),
        ...(warnings.length === 0 ? {} : { warnings }),
      }
      return { kind: "ok", thread: { ...openedThread(session), device, ...extras } }
    },
  }
}
