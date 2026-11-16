import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"
import type { ThreadSocketConnect } from "../thread/live-surface"
import { engineCode, nextActionFor, remoteFailure } from "./codes"
import type { RemoteFailure } from "./types"

/**
 * What the wire saw of one call on this device's operator endpoint: whether a frame of the watched (changing) types
 * was written, and the engine's first answer to one. A failure is judged by this, never by an error's wording.
 */
export type WireProbe = {
  sent: boolean
  answer?: { readonly success: boolean; readonly error: string }
  /** The engine's first refusal of any frame naming a session (a read included): it maps, never "unreachable". */
  refused?: string
}

const framesOf = (text: string): unknown[] =>
  text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
const field = (frame: unknown, name: string): unknown =>
  typeof frame === "object" && frame !== null ? Reflect.get(frame, name) : undefined

/** Every socket of the call records the frames of `watched` types it writes and the engine's answer to them. */
export const probing =
  (probe: WireProbe, watched: ReadonlySet<string>): ThreadSocketConnect =>
  (path): Socket => {
    const socket = createConnection(path)
    const ids = new Set<unknown>()
    const sessionFrames = new Set<unknown>()
    socket.write = new Proxy(socket.write, {
      apply: (write, self, args: unknown[]) => {
        const [chunk] = args
        if (typeof chunk === "string")
          for (const frame of framesOf(chunk)) {
            const type = field(frame, "type")
            if (field(frame, "sessionId") !== undefined) sessionFrames.add(field(frame, "id"))
            if (typeof type === "string" && watched.has(type)) {
              probe.sent = true
              ids.add(field(frame, "id"))
            }
          }
        return Reflect.apply(write, self, args)
      },
    })
    const decoder = new StringDecoder("utf8")
    let buffer = ""
    socket.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk)
      const end = buffer.lastIndexOf("\n")
      if (end < 0) return
      for (const frame of framesOf(buffer.slice(0, end))) {
        const error = field(frame, "errorCode") ?? field(frame, "error")
        const text = typeof error === "string" ? error : ""
        const success = field(frame, "success") === true
        if (probe.answer === undefined && ids.has(field(frame, "id"))) probe.answer = { success, error: text }
        if (probe.refused === undefined && !success && sessionFrames.has(field(frame, "id"))) probe.refused = text
      }
      buffer = buffer.slice(end + 1)
    })
    return socket
  }

// The engine's words for a session it does not hold.
const NO_SESSION: ReadonlySet<string> = new Set(["unknown_session", "session_not_found", "session_not_attached"])

/**
 * The engine's refusal of a frame, mapped as on the relay leg: its code comes first or after `open_failed:`
 * (`open_failed: model_unavailable: ...`), and the first part the shared engine mapping knows decides it.
 */
function engineRefusal(text: string, self: string): RemoteFailure {
  const parts = text.split(/:\s*/)
  if (parts.some((part) => NO_SESSION.has(part)))
    return remoteFailure(
      "not_found",
      `Device ${self} holds no session by that handle.`,
      "Call sessions.list or sessions.resolve for the session's current handle.",
      { details: { kind: "session", device: self, reason: text } },
    )
  const known = parts.find((part) => engineCode(part).details?.["engine_code"] === undefined)
  const mapped = engineCode(known ?? parts[0] ?? text)
  return remoteFailure(mapped.code, `This device's engine refused it (${text}).`, nextActionFor(mapped.code), {
    details: { ...mapped.details, device: self, reason: text },
  })
}

/**
 * A call on this device's operator endpoint that threw, judged by its probe: an engine refusal maps as on the relay
 * leg; nothing changing written is host_unavailable (nothing ran); a changing frame written with no answer, or answered
 * and then lost, may have run, so it is unconfirmed and uncertain.
 */
export function wireFailure(probe: WireProbe, error: unknown, self: string, what: string): RemoteFailure {
  const reason = error instanceof Error ? error.message : String(error)
  if (probe.answer?.success === false) return engineRefusal(probe.answer.error, self)
  if (probe.refused !== undefined) return engineRefusal(probe.refused, self)
  if (!probe.sent)
    return remoteFailure(
      "host_unavailable",
      `This device's omo host could not be reached, so nothing ran there (${reason}).`,
      "Start omo on this device, then retry.",
      { details: { device: self, reason } },
    )
  return remoteFailure(
    "unconfirmed",
    `This device's omo host ${probe.answer === undefined ? "did not answer" : "answered but the reply was lost"} (${reason}); it may have ${what}.`,
    "Call sessions.list or sessions.resolve for this device before trying again.",
    { uncertain: true, details: { device: self, reason, phase: probe.answer === undefined ? "send" : "read_back" } },
  )
}
