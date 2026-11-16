import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { createLocalSessionHost } from "../thread/control/local-session-host"
import type { SessionOpenRequest } from "../thread/control/session-host"
import type { ThreadToolFailure } from "../thread/errors"
import type { ThreadSocketConnect } from "../thread/live-surface"
import type { ThreadHost } from "../thread/tools/ports"
import { engineCode, nextActionFor, remoteFailure } from "./codes"
import type { RemoteFailure } from "./types"

/** This device's operator endpoint, reached as the `omo thread` SDK reaches it: no extension context needed. */
export const defaultLocalThreadHost = async (connect: ThreadSocketConnect): Promise<ThreadHost> =>
  (await import("#omo-thread-client-runtime")).createLiveThreadSurface(undefined, { connect })

export type LocalOpen =
  | { readonly kind: "ok"; readonly key: string; readonly warnings: readonly string[] }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }
  | RemoteFailure

/** What the wire saw of one open: whether an open_session frame was written, and the engine's first answer to it. */
type OpenProbe = { sent: boolean; answer?: { readonly success: boolean; readonly error: string } }

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

// Every socket of the open records the open_session frames it writes and the engine's answer to them, so a failure
// is judged by what reached the engine, never by an error's wording.
const probing =
  (probe: OpenProbe): ThreadSocketConnect =>
  (path): Socket => {
    const socket = createConnection(path)
    const opens = new Set<unknown>()
    socket.write = new Proxy(socket.write, {
      apply: (write, self, args: unknown[]) => {
        const [chunk] = args
        if (typeof chunk === "string")
          for (const frame of framesOf(chunk))
            if (field(frame, "type") === "open_session") {
              probe.sent = true
              opens.add(field(frame, "id"))
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
      for (const frame of framesOf(buffer.slice(0, end)))
        if (probe.answer === undefined && opens.has(field(frame, "id"))) {
          const error = field(frame, "errorCode") ?? field(frame, "error")
          probe.answer = { success: field(frame, "success") === true, error: typeof error === "string" ? error : "" }
        }
      buffer = buffer.slice(end + 1)
    })
    return socket
  }

// The engine's refusal text carries its code first or after `open_failed:` (`open_failed: model_unavailable: ...`):
// the first part the shared engine mapping knows decides it, as on the relay leg.
const engineRefusal = (text: string, self: string): RemoteFailure => {
  const parts = text.split(/:\s*/)
  const known = parts.find((part) => engineCode(part).details?.["engine_code"] === undefined)
  const mapped = engineCode(known ?? parts[0] ?? text)
  return remoteFailure(mapped.code, `This device's engine refused the open (${text}).`, nextActionFor(mapped.code), {
    details: { ...mapped.details, device: self, reason: text },
  })
}

/**
 * An open on this device takes the local leg (#13787): thread_create's local SessionHost on this device's own operator
 * endpoint, never the relay to itself. A failure is judged by the wire (#13787 review M1): nothing written is
 * host_unavailable; an engine refusal maps as the relay leg maps it; a written open with no answer, or one answered
 * whose read-back failed, may have made a session and is uncertain. The device service then names the key it lists
 * the session by; when it cannot, the session is answered under its durable id with a warning.
 */
export async function openOnThisDevice(
  svc: DeviceService,
  hostOn: (connect: ThreadSocketConnect) => Promise<ThreadHost>,
  self: string,
  request: SessionOpenRequest,
): Promise<LocalOpen> {
  const probe: OpenProbe = { sent: false }
  let opened: Awaited<ReturnType<ReturnType<typeof createLocalSessionHost>["open"]>>
  try {
    opened = await createLocalSessionHost(await hostOn(probing(probe)), []).open(request)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (probe.answer?.success === false) return engineRefusal(probe.answer.error, self)
    if (!probe.sent)
      return remoteFailure(
        "host_unavailable",
        `This device's omo host could not be reached; no session was opened (${reason}).`,
        "Start omo on this device, then call sessions.open again.",
        { details: { device: self, reason } },
      )
    return remoteFailure(
      "unconfirmed",
      `This device's omo host ${probe.answer === undefined ? "did not answer the open" : "opened a session but did not list it"} (${reason}); a session may exist.`,
      "Call sessions.list or sessions.resolve for this device before opening again.",
      {
        uncertain: true,
        details: { device: self, reason, phase: probe.answer === undefined ? "open" : "read_back" },
      },
    )
  }
  if (opened.kind === "error") return opened
  const durable = opened.thread.thread_id
  try {
    return { kind: "ok", key: (await svc.locate(self, durable)).key, warnings: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: "ok",
      key: durable,
      warnings: [`This device's service did not name the listing key of session ${durable} (${reason}).`],
    }
  }
}
