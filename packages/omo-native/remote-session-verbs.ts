import type { DeviceService } from "../device-service-core/src/index.ts"
import type { ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"
import { createRelaySessionHost } from "../omo-senpi/src/components/thread/control/relay-session-host"
import { createDeviceServiceSessions } from "../omo-senpi/src/components/thread/remote/device-service"
import type { RemoteSessionRow, RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { setModelRemote } from "../omo-senpi/src/components/thread/remote/remote-controls"
import {
  closeRemote,
  followRemote,
  interruptRemote,
  promptRemote,
  remoteAvailable,
  type RemoteSendRequest,
  runningTurnRemote,
} from "../omo-senpi/src/components/thread/remote/remote-ops"
import type { RemoteCommandDependencies } from "./remote-cli"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { sessionVerbLines } from "./remote-render"
import { localPermissionPreset } from "./remote-permission-preset"
import type { SessionArgs } from "./remote-session-args"

// The surface the agent's thread tools reach other devices through, on this command's own connection. The chain count
// (K8) starts at its first hop: a person at a terminal is no thread chain.
const deviceServiceSurface = (service: DeviceService): RemoteThreadSurface => ({
  sessions: createDeviceServiceSessions({ version: service.serviceVersion, connect: async () => service }),
  chain: { stamp: record => record },
})

type Show = (result: ThreadToolResult, label: string) => number

// The device service refuses a session the other device does not hold with session_not_found; the remote port reports
// it as the engine's unknown_session (#12755). Either names a session that is not on this account.
const NO_SUCH_SESSION: ReadonlySet<string> = new Set(["session_not_found", "unknown_session"])

/**
 * The session verbs: each is one of the thread tools' remote ops (omo-senpi thread/remote), so the agent and this CLI
 * reach another device's session the same way. --json prints the op's typed result as is.
 */
export async function runSession(service: DeviceService, args: SessionArgs, json: boolean, dependencies: RemoteCommandDependencies): Promise<number> {
  const remote = (dependencies.remote ?? deviceServiceSurface)(service)
  const show: Show = (result, label) => {
    if (json) dependencies.output(JSON.stringify(result))
    if (result.kind === "error") {
      if (!json && label !== "" && NO_SUCH_SESSION.has(String(result.error.details?.["reason"]))) {
        dependencies.error(`omo remote: no session ${label} on this account.`)
        dependencies.error("Run omo remote sessions to see them.")
      } else if (!json) {
        dependencies.error(`omo remote: ${result.error.message}`)
        dependencies.error(result.error.next_action)
      }
      return REMOTE_EXIT.failed
    }
    if (!json) for (const line of sessionVerbLines(args.verb, label, result)) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return show(unavailable, "")
  if (args.verb === "open") return await openOn(remote, args, { json, show }, dependencies)
  const label = `${args.target.device}/${args.target.session}`
  // Addressed directly, as the SDK does: its device refuses a session it does not hold (unknown_session). The
  // account listing settles only with the slowest device (seconds) and lags a session just opened.
  const row: RemoteSessionRow = { device: args.target.device, session_id: args.target.session, title: "", project: "", path: "", state: "idle", updated_ms: 0 }
  switch (args.verb) {
    case "model":
      return show(await setModelRemote(remote, row, { model: args.model }), label)
    case "interrupt":
      return show(await interruptRemote(remote, row, undefined), label)
    case "close":
      return show(await closeRemote(remote, row), label)
    case "send":
      return sendTo(remote, row, args, { label, json, show }, dependencies)
  }
}

async function openOn(
  remote: RemoteThreadSurface,
  args: Extract<SessionArgs, { readonly verb: "open" }>,
  { json, show }: { readonly json: boolean; readonly show: Show },
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  let mode: string
  try {
    mode = args.permissionPreset ?? (dependencies.localPermissionPreset ?? localPermissionPreset)()
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    dependencies.error(error.message)
    return REMOTE_EXIT.usage
  }
  const open = await createRelaySessionHost(remote, args.device).open({ permissionPreset: mode, ...(args.project === undefined ? {} : { cwd: args.project }) })
  const opened: ThreadToolResult = open.kind === "ok" ? { kind: "ok", thread: open.thread, deduplicated: false } : open
  if (opened.kind !== "ok" || !("thread" in opened) || args.model === undefined) return show(opened, "")
  const label = `${args.device}/${opened.thread.thread_id}`
  const created: RemoteSessionRow = { device: args.device, session_id: opened.thread.thread_id, title: opened.thread.name, project: opened.thread.cwd, path: "", state: "idle", updated_ms: 0 }
  const model = await setModelRemote(remote, created, { model: args.model })
  if (model.kind === "error") {
    // The session exists on its device (opened to be kept), so the failure names it: a retry must not leave another one
    // behind unseen. --json: the model's typed error with the thread that was opened.
    if (json) dependencies.output(JSON.stringify({ ...model, thread: opened.thread }))
    else {
      dependencies.output(label)
      dependencies.error(`omo remote: opened ${label}, but its model was not set: ${model.error.message}`)
      dependencies.error(`${model.error.next_action} The session is still open; end it with omo remote close ${label}.`)
    }
    return REMOTE_EXIT.failed
  }
  if (!("model" in model)) return show(model, label)
  return show({ ...opened, model: model.model } as ThreadToolResult, "")
}

async function sendTo(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  args: Extract<SessionArgs, { readonly verb: "send" }>,
  { label, json, show }: { readonly label: string; readonly json: boolean; readonly show: Show },
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  let request: RemoteSendRequest = { message: args.text, delivery: args.delivery }
  // A person steers whatever runs; the op still checks that turn, and the engine checks it again on arrival.
  if (args.delivery === "steer") {
    const running = await runningTurnRemote(remote, row)
    if (running.kind === "error") return show(running, label)
    if (!("turn_id" in running) || running.turn_id === undefined) {
      dependencies.error(`omo remote: nothing is running on ${label} to steer.`)
      dependencies.error("Send without --steer to start a turn.")
      return REMOTE_EXIT.failed
    }
    request = { ...request, expected_turn_id: running.turn_id }
  }
  // The person at this terminal sends their own input as a prompt; a peer session's message is a delivery (#12882).
  if (!args.wait) return show(await promptRemote(remote, row, request), label)
  // Followed before the send, so no delta of the turn it starts can arrive unseen.
  let reply = ""
  const follow = await followRemote(remote, row, text => {
    reply += text
    if (!json) dependencies.write(text)
  })
  if ("kind" in follow) return show(follow, label)
  try {
    const sent = await promptRemote(remote, row, request)
    if (sent.kind === "error") return show(sent, label)
    const end = await follow.settled
    if (!json && reply.length > 0 && !reply.endsWith("\n")) dependencies.write("\n")
    // --json: the send's typed result, with the answer it streamed.
    if (json && end === "settled") dependencies.output(JSON.stringify({ ...sent, reply }))
    if (end !== "settled") {
      dependencies.error(`omo remote: the session on ${row.device} ended before its turn settled (${end}).`)
      return REMOTE_EXIT.failed
    }
    return REMOTE_EXIT.ok
  } finally {
    follow.stop()
  }
}
