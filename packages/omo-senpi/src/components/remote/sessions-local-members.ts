import { interruptOver } from "../thread/control/interrupt"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost, ThreadSessionPort } from "../thread/tools/ports"
import { ok, type Outcome } from "./client"
import { nextActionFor, remoteFailure } from "./codes"
import { probing, wireFailure, type WireProbe } from "./local-wire"
import { sessionDetail } from "./session-detail"
import type {
  DeviceRow,
  InterruptResult,
  ReadPage,
  RemoteFailure,
  SendReceipt,
  SendRequest,
  SessionDetail,
  SessionRow,
  ThreadHandle,
} from "./types"

type HostOn = (connect: ThreadSocketConnect) => Promise<ThreadHost>
/** A session of this device as a resolved handle names it: its device, its handle's part, its listing row if listed. */
type LocalTarget = { readonly device: string; readonly session: string; readonly row?: SessionRow }
type Found = { readonly port: ThreadSessionPort; readonly routing: string; readonly durable: string }

// The records that change the session; a read changes nothing, so its lost reply is never uncertain.
const CHANGING: ReadonlySet<string> = new Set([
  "prompt",
  "interrupt",
  "unload_session",
  "close_session",
  "set_thinking_level",
  "set_session_archived",
])

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

const notHeld = (device: string, session: string): RemoteFailure =>
  remoteFailure(
    "not_found",
    `Device ${device} holds no session ${session}.`,
    "Call sessions.list or sessions.resolve for the session's current handle.",
    { details: { kind: "session", device } },
  )

/**
 * The session members for a session on this device (#13787): the service's relay cannot route to the device that asks,
 * so each runs on this device's own operator endpoint, the same host a local open uses, and a failure is judged by the
 * wire (local-wire.ts). The session is found by its durable id (the listing row's, else the handle's own part).
 */
export function localSessionMembers(hostOn: HostOn) {
  const run = async <T>(
    target: LocalTarget,
    what: string,
    body: (found: Found) => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> => {
    const probe: WireProbe = { sent: false }
    try {
      const host = await hostOn(probing(probe, CHANGING))
      const durable = target.row?.durable_id ?? target.session
      const sessions = host.listView !== undefined ? (await host.listView()).sessions : await host.listSessions()
      const found = sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durable)
      if (found === undefined) return notHeld(target.device, target.session)
      const port = found.socket !== undefined && host.endpoint !== undefined ? host.endpoint(found.socket) : host
      return await body({ port, routing: found.sessionId, durable })
    } catch (error) {
      return wireFailure(probe, error, target.device, what)
    }
  }

  return {
    close: (target: LocalTarget, force = false) =>
      run(target, "closed the session", async ({ port, routing, durable }) => {
        if (port.closeSession === undefined)
          return remoteFailure(
            "unsupported",
            "This device's host does not take close requests.",
            nextActionFor("unsupported"),
            {
              details: { feature: "close", device: target.device },
            },
          )
        const { outcome, dropped_deliveries } = await port.closeSession(routing, durable, force ? { force } : {})
        if (outcome === "held_elsewhere")
          return remoteFailure(
            "foreign_live_owner",
            `Session ${target.session} has no file yet and another client still holds it; only this hold was released.`,
            "Close it from the client that holds it, or call sessions.send first so it can be closed for every holder.",
            { details: { device: target.device } },
          )
        return ok({ closed: outcome === "closed", dropped_deliveries: [...dropped_deliveries] })
      }),
    interrupt: (target: LocalTarget, thread: ThreadHandle): Promise<Outcome<InterruptResult>> =>
      run(target, "interrupted the turn", async ({ port, routing, durable }) => {
        // The thread tools' one interrupt body: this device's host gets the record thread_interrupt sends.
        const outcome = await interruptOver((request) => port.interrupt(routing, request, durable), undefined)
        return ok({ thread, ...outcome, device: target.device })
      }),
    setReasoning: (target: LocalTarget, level: string) =>
      run(target, "set the thinking level", async ({ port, routing, durable }) => {
        try {
          await port.setThinkingLevel(routing, level, "turn", durable)
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("thinking_level_unsupported:")) throw error
          return remoteFailure(
            "thinking_level_unsupported",
            `Thinking level "${level}" is not supported by the active model.`,
            nextActionFor("thinking_level_unsupported"),
            { details: { supported: await port.getAvailableThinkingLevels(routing), device: target.device } },
          )
        }
        return ok({ reasoning: level })
      }),
    archive: (target: LocalTarget, archived: boolean) =>
      run(target, archived ? "archived the session" : "unarchived the session", async ({ port, routing, durable }) => {
        const unsupported = () =>
          remoteFailure(
            "unsupported",
            "This device's engine does not know set_session_archived: it runs a senpi from before archived sessions.",
            nextActionFor("unsupported"),
            { details: { feature: "archive", device: target.device } },
          )
        if (port.setSessionArchived === undefined) return unsupported()
        try {
          await port.setSessionArchived(routing, archived, durable)
        } catch (error) {
          if (error instanceof Error && error.message === "unsupported:set_session_archived") return unsupported()
          throw error
        }
        return ok({ archived })
      }),
    get: (target: LocalTarget, thread: ThreadHandle, device: DeviceRow): Promise<Outcome<SessionDetail>> =>
      run(target, "read", async ({ port, routing }) => {
        const state = await port.getState(routing)
        // The listing names the session; its engine says whether a turn runs now.
        const listed: SessionRow | undefined =
          target.row === undefined
            ? undefined
            : { ...target.row, state: state.isStreaming === true ? "running" : "idle" }
        return ok(sessionDetail(thread, device, listed, state))
      }),
    read: (
      target: LocalTarget,
      page?: { readonly before?: string; readonly tail?: number },
    ): Promise<Outcome<ReadPage>> =>
      run(target, "read", async ({ port, routing }) => {
        const all = (await port.getMessages(routing)).map((entry, index) => ({
          entry_id: text(entry["id"]) ?? String(index),
          entry,
        }))
        const end = page?.before === undefined ? all.length : all.findIndex((item) => item.entry_id === page.before)
        const upTo = all.slice(0, end < 0 ? all.length : end)
        const entries = page?.tail === undefined ? upTo : upTo.slice(-page.tail)
        const first = entries[0]
        return ok({ entries, next_before: first !== undefined && upTo.length > entries.length ? first.entry_id : null })
      }),
    // A person's own input, as the relay leg's person path sends it: a prompt that starts or queues a turn, or steers
    // the running one.
    send: (
      target: LocalTarget,
      thread: ThreadHandle,
      device: DeviceRow,
      request: SendRequest,
      clientMessageId: string,
    ): Promise<Outcome<SendReceipt>> =>
      run<SendReceipt>(target, "delivered the message", async ({ port, routing, durable }) => {
        // The prompt's client message id, the receipt's delivery_id (senpi stamps it on the turn that answers it). The
        // host's port spreads its options onto the prompt record, so the id rides beside streamingBehavior.
        const stamped = (streamingBehavior: "steer" | "followUp", expectedTurnId?: string) => ({
          streamingBehavior,
          clientMessageId,
          // A steer names the turn it read, so the engine refuses it if that turn ended in between (#13787 review L4).
          ...(expectedTurnId === undefined ? {} : { expectedTurnId }),
        })
        const state = await port.getState(routing)
        const running = state.isStreaming === true
        const turn = text(Reflect.get(state, "currentTurnId"))
        if (request.mode === "steer") {
          if (!running || turn === undefined)
            return remoteFailure(
              "not_steerable",
              `Nothing is running on ${thread} to steer.`,
              nextActionFor("not_steerable"),
              {
                details: { device: target.device },
              },
            )
          if (request.expected_turn_id !== undefined && String(request.expected_turn_id) !== turn)
            return remoteFailure(
              "turn_conflict",
              `Turn ${request.expected_turn_id} is not the running turn.`,
              nextActionFor("turn_conflict"),
              {
                details: { device: target.device, current_turn_id: turn },
              },
            )
          await port.prompt(routing, request.text, stamped("steer", turn), durable)
          return ok({ thread, device, delivery_id: clientMessageId, lane: "steered", turn_id: turn })
        }
        const reply = await port.prompt(routing, request.text, stamped("followUp"), durable)
        const started = text(reply.turnId)
        if (Reflect.get(reply, "disposition") === "started" || (!running && started !== undefined))
          return ok({
            thread,
            device,
            delivery_id: clientMessageId,
            lane: "started",
            ...(started === undefined ? {} : { turn_id: started }),
          })
        // The engine took the prompt: a failed queue read after it leaves the position unknown, never the delivery.
        const after = await port.getState(routing).catch(() => undefined)
        const pending = after === undefined ? undefined : Reflect.get(after, "pendingMessageCount")
        return ok({
          thread,
          device,
          delivery_id: clientMessageId,
          lane: "queued",
          queue_position: typeof pending === "number" && pending >= 1 ? pending : 1,
        })
      }),
  }
}
