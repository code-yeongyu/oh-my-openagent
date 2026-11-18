import type { DeviceService } from "../device-service-core/src/index.ts"
import type { ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"
import { createRelaySessionHost } from "../omo-senpi/src/components/thread/control/relay-session-host"
import {
  answered,
  closeThread,
  interruptThread,
  setModelOn,
} from "../omo-senpi/src/components/thread/control/operations"
import { createRelayControl } from "../omo-senpi/src/components/thread/control/relay-control"
import { createDeviceServiceSessions } from "../omo-senpi/src/components/remote/port/device-service"
import { type LocalSessions, remoteClientForPerson } from "../omo-senpi/src/components/remote/index"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createGatewayStore, GATEWAY_STORE_WORKER_BUNDLE_NAME } from "../omo-senpi/src/components/thread/gateway/store"
import { resolveProvenance } from "../omo-senpi/src/components/thread/gateway/provenance-resolver"
import { createRelayTransport } from "../omo-senpi/src/components/thread/remote/relay-transport"
import { createGatewayEngine, resolveFromEntries } from "../omo-senpi/src/components/thread/gateway/engine"
import { createLocalTransport } from "../omo-senpi/src/components/thread/gateway/local-transport"
import { createDeliveryPipeline } from "../omo-senpi/src/components/thread/gateway/pipeline"
import { createdDeviceRow, namedDeviceRow } from "../omo-senpi/src/components/thread/remote/address-book"
import { stampThisDevice } from "../omo-senpi/src/components/thread/remote/this-device"
import type { Provenance } from "../omo-senpi/src/components/thread/gateway/types"
import { threadLink } from "../omo-senpi/src/components/thread/thread-link"
import { openedResult } from "../omo-senpi/src/components/thread/tools/thread-row"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { packageRoot } from "./bin/lib/package-paths.js"
import {
  rowThreadId,
  type RemoteSessionRow,
  type RemoteThreadSurface,
} from "../omo-senpi/src/components/thread/remote/ports"
import { resolveSessionTarget } from "./remote-session-target"
import { deviceOnline, followRemote, remoteAvailable } from "../omo-senpi/src/components/thread/remote/remote-ops"
import type { RemoteCommandDependencies } from "./remote-local"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { sendWaitNotice, sessionVerbLines } from "./remote-render"
import { localPermissionPreset } from "./remote-permission-preset"
import type { SessionArgs } from "./remote-session-args"

/**
 * Where the gateway store's worker is in the shipped `omo`: the `gateway-store-worker.mjs` sidecar beside the plugin's
 * extension bundle (`<package>/plugin/extensions/`), the one place the payload carries it; `bin/lib` holds no worker, so
 * the store's default (a worker beside the module it runs in) finds nothing there. From source the sidecar is absent and
 * the store resolves `store-worker.ts` itself. Returns the anchor the store resolves the sidecar from, or undefined.
 */
export function gatewayWorkerAnchor(root: string = packageRoot): URL | undefined {
  const anchor = pathToFileURL(join(root, "plugin", "extensions", "omo.js"))
  return existsSync(new URL(`./${GATEWAY_STORE_WORKER_BUNDLE_NAME}`, anchor)) ? anchor : undefined
}

// The surface the agent's thread tools reach other devices through, on this command's own connection. The chain count
// (K8) starts at its first hop: a person at a terminal is no thread chain. The command's one connection is shared:
// the port borrows it (never closes it); only `open_session` rides a fresh connection per call (#12777), so opening a
// session never closes the CLI's only connection (#13075).
const deviceServiceSurface = (
  service: DeviceService,
  dial: () => Promise<DeviceService>,
  stateDir: string,
  localSessions: (() => Promise<LocalSessions>) | undefined,
): RemoteThreadSurface => ({
  sessions: createDeviceServiceSessions({
    version: service.serviceVersion,
    connect: async () => ({ conn: service, owned: false }),
    dialEndpoint: async () => ({ conn: await dial(), owned: true }),
  }),
  // `omo remote` is a person at this device; the account reads go through the one remote client (#13414).
  client: remoteClientForPerson({
    version: service.serviceVersion,
    stateDir,
    connect: async () => borrowedService(service),
    // This device's own sessions come from its operator endpoint, injected from outside the local-only graph (#13968).
    ...(localSessions === undefined ? {} : { localSessions }),
  }),
  chain: { stamp: (record) => record },
})

/**
 * The command's one device-service connection, lent to its remote client: the client's account reads ride it, and the
 * client's close() leaves it open for the command, which closes it itself.
 */
export const borrowedService = (service: DeviceService): DeviceService =>
  new Proxy(service, {
    get: (target, key) => {
      if (key === "close") return () => undefined
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

type Show = (result: ThreadToolResult, label: string) => number

// The device service refuses a session the other device does not hold with session_not_found; the remote port reports
// it as the engine's unknown_session (#12755). Either names a session that is not on this account.
const NO_SUCH_SESSION: ReadonlySet<string> = new Set(["session_not_found", "unknown_session"])

/**
 * The session verbs: each runs the thread tools' one body for that operation (omo-senpi thread/control) over the relay
 * control of the session, so the agent and this CLI reach another device's session the same way. --json prints the
 * body's typed result as is.
 */
export async function runSession(
  service: DeviceService,
  args: SessionArgs,
  json: boolean,
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  const remote = (
    dependencies.remote ??
    ((service) =>
      deviceServiceSurface(service, dependencies.connect, dependencies.stateDir, dependencies.localSessions))
  )(service)
  // The client holds its own device-service connection; a command that left it open would keep the process alive. The
  // sessions port owns the attach pool: closing it clears the pool's idle-detach timers (#14074) and closes only a
  // connection the port dialed itself, never the command's borrowed one.
  try {
    return await runSessionOn(remote, args, json, dependencies)
  } finally {
    remote.client.close()
    await remote.sessions.close?.()
  }
}

async function runSessionOn(
  remote: RemoteThreadSurface,
  args: SessionArgs,
  json: boolean,
  dependencies: RemoteCommandDependencies,
): Promise<number> {
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
  const label = args.target.device === undefined ? args.target.session : `${args.target.device}/${args.target.session}`
  // `<device>/<session>` is addressed directly, as the SDK does (the port locates a durable id its listing lags on); a
  // bare durable id is found in the account listing (omo#13707).
  const resolved = await resolveSessionTarget(remote, args.target)
  if (resolved.kind === "error") return show(resolved, label)
  const { row } = resolved
  if (args.verb === "send") return sendTo(remote, row, args, { label, json, show }, dependencies)
  // The device is found online once, before its control is used, as the thread tools' locate does (A3).
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return show(offline, label)
  const control = createRelayControl(remote, row)
  switch (args.verb) {
    case "model":
      return show(await answered(() => setModelOn(control, args.model, undefined)), label)
    case "interrupt":
      return show(await answered(() => interruptThread(control, undefined)), label)
    case "close":
      return show(await answered(() => closeThread(control)), label)
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
  // One open through the shared create path (#13409): the model and thinking level are the engine's launch profile on the
  // open_session frame, so a model the device cannot run refuses the open and no session is left behind.
  const open = await createRelaySessionHost(remote, args.device).open({
    permissionPreset: mode,
    ...(args.project === undefined ? {} : { cwd: args.project }),
    ...(args.model === undefined ? {} : { provider: args.model.provider, modelId: args.model.modelId }),
    ...(args.thinking === undefined ? {} : { thinkingLevel: args.thinking }),
    ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
  })
  if (open.kind !== "ok") return show(open, "")
  // --json keeps naming the model the session opened on, as it did when a set_model followed the open (#13748 review).
  const opened = {
    ...openedResult(open.thread, false),
    ...(args.model === undefined ? {} : { model: { provider: args.model.provider, id: args.model.modelId } }),
  } as ThreadToolResult
  if (args.prompt === undefined) return show(opened, "")
  // The first prompt (#13410) goes to the session just opened, by its own id, as `omo remote send --no-wait` sends it.
  const label = `${args.device}/${open.thread.thread_id}`
  const row = createdDeviceRow(args.device, open.thread)
  const delivery = personDelivery(remote, dependencies)
  let sent: ThreadToolResult
  try {
    sent = await delivery.deliver(row, label, args.prompt, args.delivery ?? "auto")
  } finally {
    await delivery.dispose()
  }
  const prompt =
    sent.kind === "error"
      ? { error: sent.error }
      : "delivery" in sent
        ? { delivery: sent.delivery, deduplicated: sent.deduplicated }
        : {}
  if (json) dependencies.output(JSON.stringify({ ...opened, prompt }))
  else {
    for (const line of sessionVerbLines("open", "", opened)) dependencies.output(line)
    if (sent.kind === "error") {
      dependencies.error(`omo remote: opened ${label}, but its first prompt was not delivered: ${sent.error.message}`)
      dependencies.error(`${sent.error.next_action} Send it again with omo remote send ${label} <text>.`)
    }
  }
  return sent.kind === "error" ? REMOTE_EXIT.failed : REMOTE_EXIT.ok
}

/**
 * The person at this terminal sends their own input through the one delivery pipeline the thread tools use (#12885,
 * #13016): the target's kind picks the transport, and the relay keeps a `person` sender on the engine's prompt record.
 * Its receipt is written to this device's gateway store under a key minted per invocation (a person's retry is a new
 * send, so nothing dedupes it). A steer names no turn: the transport reads the running one once and steers it.
 */
function personDelivery(remote: RemoteThreadSurface, dependencies: RemoteCommandDependencies) {
  const anchor = gatewayWorkerAnchor(dependencies.packageRoot ?? packageRoot)
  const store = createGatewayStore({
    agentDir: canonicalAgentDir(),
    ...(anchor === undefined ? {} : { workerModuleUrl: anchor }),
  })
  // This device stamped as on every delivery path (#13004), through the one pipeline (#13016).
  const senderProvenance = personSenderProvenance(remote)
  // This command holds no session of its own, so the local transport's engine has an empty address book.
  const engine = createGatewayEngine({
    store,
    endpoints: {
      wake: async (endpoint) => {
        throw new Error(`host_unavailable:${endpoint.socket}`)
      },
    },
    resolve: resolveFromEntries(
      () => [],
      () => process.cwd(),
    ),
    senderProvenance,
  })
  const pipeline = createDeliveryPipeline({
    local: createLocalTransport(engine),
    relay: createRelayTransport({ remote, store, senderProvenance }),
  })
  const person = { kind: "person" as const, uid: process.getuid?.() ?? 0, user: userInfo().username }
  const deliver = async (
    row: RemoteSessionRow,
    label: string,
    text: string,
    mode: "auto" | "steer" | "follow_up",
    clientMessageId?: string,
  ): Promise<ThreadToolResult> => {
    const sent = await pipeline.deliver({
      sender: person,
      caller_id: `person:${person.uid}`,
      target: { kind: "remote", row },
      text,
      mode,
      idempotency_key: randomUUID(),
      ...(clientMessageId === undefined ? {} : { client_message_id: clientMessageId }),
      args: { target: label, text, delivery: mode },
    })
    if (sent.kind === "error") return sent
    if (!("device" in sent))
      return {
        kind: "error",
        error: {
          code: "internal_error",
          message: `A send to ${label} was answered by this device's gateway.`,
          next_action: "Report this: a device-named address goes to the relay transport.",
        },
      }
    return {
      kind: "ok",
      thread: rowThreadId(row),
      link: threadLink(rowThreadId(row), row.title),
      delivery: sent.delivery,
      deduplicated: sent.deduplicated,
      device: row.device,
    }
  }
  const dispose = async () => {
    pipeline.dispose()
    await store.dispose()
  }
  return { deliver, dispose }
}

/** The provenance a person's `omo remote send` carries: this device stamped as on every delivery path (#13004). */
export function personSenderProvenance(
  remote: RemoteThreadSurface,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<Provenance> {
  return () => stampThisDevice(resolveProvenance({ cwd, env }), remote)
}

async function sendTo(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  args: Extract<SessionArgs, { readonly verb: "send" }>,
  { label, json, show }: { readonly label: string; readonly json: boolean; readonly show: Show },
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  const delivery = personDelivery(remote, dependencies)
  // A waiting send names its prompt, so the follow finds the entry senpi stores for it whatever text it holds.
  const clientMessageId = args.wait ? randomUUID() : undefined
  const deliver = () => delivery.deliver(row, label, args.text, args.delivery, clientMessageId)
  const nothingToSteer = (result: ThreadToolResult): number | undefined => {
    if (result.kind !== "error" || result.error.code !== "not_steerable" || json) return undefined
    dependencies.error(`omo remote: nothing is running on ${label} to steer.`)
    dependencies.error("Send without --steer to start a turn.")
    return REMOTE_EXIT.failed
  }
  let follow: Awaited<ReturnType<typeof followRemote>> | undefined
  try {
    // The person at this terminal sends their own input as a prompt; a peer session's message is a delivery (#12882).
    if (!args.wait) {
      const sent = await deliver()
      return nothingToSteer(sent) ?? show(sent, label)
    }
    // Followed before the send, so no delta of the turn it starts can arrive unseen, and aimed once the send's own
    // reply names its lane: a started or steered send streams its turn from the aim, a queued one is read from the
    // transcript anchored on this send's user entry, so only that turn's text prints and only its end ends the wait
    // (#13267).
    let reply = ""
    follow = await followRemote(
      remote,
      row,
      (text) => {
        reply += text
        if (!json) dependencies.write(text)
      },
      { text: args.text, ...(clientMessageId === undefined ? {} : { clientMessageId }) },
    )
    if ("kind" in follow) return show(follow, label)
    const sent = await deliver()
    if (sent.kind === "error") return nothingToSteer(sent) ?? show(sent, label)
    // The ok send always carries its delivery; without one the attach's own end still settles the follow below.
    if ("delivery" in sent)
      follow.aim(sent.delivery.kind === "started" ? "started" : sent.delivery.kind === "steered" ? "steered" : "queued")
    // A send that waits behind a running turn says so at once (#13268); stdout stays the answer alone, so this is stderr.
    const waitNotice = sendWaitNotice(label, sent)
    if (waitNotice !== null && !json) dependencies.error(waitNotice)
    const end = await follow.settled
    if (!json && reply.length > 0 && !reply.endsWith("\n")) dependencies.write("\n")
    // --json: the send's typed result, with the answer it streamed.
    if (json && end === "settled") dependencies.output(JSON.stringify({ ...sent, reply }))
    if (end === "interrupted") {
      dependencies.error(`omo remote: the turn on ${label} was interrupted before it finished.`)
      return REMOTE_EXIT.failed
    }
    if (end !== "settled") {
      dependencies.error(`omo remote: the session on ${row.device} ended before its turn settled (${end}).`)
      return REMOTE_EXIT.failed
    }
    return REMOTE_EXIT.ok
  } finally {
    // Every exit, early refusals included, releases the follow and the store worker this send opened.
    if (follow !== undefined && !("kind" in follow)) follow.stop()
    await delivery.dispose()
  }
}
