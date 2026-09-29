// The local surface: one HTTP API plus one websocket, for the gateway's voice pipeline and for any
// agent that follows the skill.
//
// It binds the loopback address only, so nothing off this machine can reach it, and every request
// carries the token from the 0600 file - on a shared machine "local" is not the same as "the
// operator". Audio is never written to disk here; it crosses this surface and is gone.

import { isSampleRate } from "./audio"
import { recordOf } from "./json"
import type { HuddleControl } from "./driver"
import { offeredToken, tokenMatches } from "./token"
import { VoiceFatal, VoiceRefusal } from "./voice-contract"
import { decodeAudioFrame, inboundFrame } from "./wire"

export type HuddleServerOptions = {
  readonly driver: HuddleControl
  readonly token: string
  readonly port?: number
  readonly hostname?: string
}

export type HuddleServer = { readonly port: number; readonly url: string; stop(): Promise<void> }

type Socket = { unsubscribe(): void }

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

/** A refusal is the caller's fault, a fatal is the surface's; anything else is a bug worth 500. */
const errorResponse = (error: unknown): Response => {
  if (error instanceof VoiceRefusal) return json({ error: error.message, reason: error.reason }, 409)
  if (error instanceof VoiceFatal) return json({ error: error.message, fatal: true }, 502)
  return json({ error: error instanceof Error ? error.message : "the huddle surface failed" }, 500)
}

export function serveHuddle(options: HuddleServerOptions): HuddleServer {
  const { driver, token } = options
  const sockets = new Map<object, Socket>()

  const server = Bun.serve<{ authed: true }>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,
    async fetch(request, self) {
      if (!tokenMatches(token, offeredToken(request.headers))) return json({ error: "this surface needs the huddle token" }, 401)
      const { pathname } = new URL(request.url)
      if (pathname === "/stream") {
        return self.upgrade(request, { data: { authed: true } }) ? undefined : json({ error: "the stream endpoint takes a websocket" }, 400)
      }
      try {
        if (pathname === "/status" && request.method === "GET") return json(driver.status())
        if (pathname === "/join" && request.method === "POST") {
          const chat_id = String(recordOf(await request.json()).chat_id ?? "")
          if (chat_id === "") return json({ error: "join needs a chat_id" }, 400)
          return json({ call: await driver.join(chat_id) })
        }
        if (pathname === "/leave" && request.method === "POST") {
          await driver.leave()
          return json({ ok: true, status: driver.status() })
        }
        if (pathname === "/capture" && request.method === "POST") {
          await driver.setCapture(recordOf(await request.json()).on === true)
          return json({ ok: true, capturing: driver.status().capturing })
        }
        if (pathname === "/speak" && request.method === "POST") {
          const frame = decodeAudioFrame(new Uint8Array(await request.arrayBuffer()))
          await driver.speak(frame.pcm16, frame.sample_rate, request.signal)
          return json({ ok: true, samples: frame.pcm16.length })
        }
        if (pathname === "/stats" && request.method === "GET") return json({ stats: await driver.stats() })
        return json({ error: `no route for ${request.method} ${pathname}` }, 404)
      } catch (error) {
        return errorResponse(error)
      }
    },
    websocket: {
      open(ws) {
        const offEvent = driver.onEvent((event) => ws.send(JSON.stringify(event)))
        const offAudio = driver.onAudio((frame) => ws.send(inboundFrame(frame)))
        sockets.set(ws, {
          unsubscribe() {
            offEvent()
            offAudio()
          },
        })
        ws.send(JSON.stringify({ kind: "hello", status: driver.status() }))
      },
      async message(ws, message) {
        try {
          if (typeof message !== "string") {
            const frame = decodeAudioFrame(message instanceof Uint8Array ? message : new Uint8Array(message))
            if (!isSampleRate(frame.sample_rate)) throw new VoiceRefusal("capability", "that sample rate is not supported")
            await driver.speak(frame.pcm16, frame.sample_rate)
            return
          }
          const command = recordOf(JSON.parse(message))
          if (command.type === "join" && typeof command.chat_id === "string") {
            ws.send(JSON.stringify({ kind: "joined_ack", call: await driver.join(command.chat_id) }))
            return
          }
          if (command.type === "leave") {
            await driver.leave()
            ws.send(JSON.stringify({ kind: "left_ack" }))
            return
          }
          if (command.type === "capture") {
            await driver.setCapture(command.on === true)
            ws.send(JSON.stringify({ kind: "capture_ack", capturing: driver.status().capturing }))
            return
          }
          ws.send(JSON.stringify({ kind: "error", message: "unknown command" }))
        } catch (error) {
          const message_text = error instanceof Error ? error.message : "the command failed"
          ws.send(JSON.stringify({ kind: "error", message: message_text, fatal: error instanceof VoiceFatal }))
        }
      },
      close(ws) {
        sockets.get(ws)?.unsubscribe()
        sockets.delete(ws)
      },
    },
  })

  const port = server.port ?? 0
  return {
    port,
    url: `http://${server.hostname ?? "127.0.0.1"}:${port}`,
    async stop() {
      for (const [, socket] of sockets) socket.unsubscribe()
      sockets.clear()
      await server.stop(true)
    },
  }
}
