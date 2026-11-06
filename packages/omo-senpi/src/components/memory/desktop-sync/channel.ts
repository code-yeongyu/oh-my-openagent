import type { Duplex } from "node:stream"
import { readFrames, writeFrame } from "./framing"
import {
  desktopSyncChild, desktopSyncEvent, desktopSyncReply, desktopSyncRequest, DesktopSyncUnavailable,
  type DesktopSyncEvent, type DesktopSyncRequest,
} from "./protocol"

export type { DesktopSyncEvent, DesktopSyncRequest } from "./protocol"

export interface DesktopSyncChannel {
  readonly signal: AbortSignal
  request(request: DesktopSyncRequest): Promise<unknown>
  onEvent(listener: (event: DesktopSyncEvent) => void): () => void
  close(): void
}

export type DesktopSyncAttachment =
  | { readonly kind: "connected"; readonly channel: DesktopSyncChannel }
  | { readonly kind: "unavailable"; readonly reason: "private_channel_unavailable" | "platform_not_supported" }

/** Registration owns the supplied stream. No endpoint lookup or alternate account source exists here. */
export async function attachDesktopSyncChannel(stream: Duplex | undefined): Promise<DesktopSyncAttachment> {
  if (process.platform === "win32") {
    stream?.destroy()
    return { kind: "unavailable", reason: "platform_not_supported" }
  }
  if (stream === undefined) return { kind: "unavailable", reason: "private_channel_unavailable" }
  const lifetime = new AbortController()
  const waiting = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>()
  const listeners = new Set<(event: DesktopSyncEvent) => void>()
  let nextId = 0
  let child: string | undefined
  const close = () => {
    if (lifetime.signal.aborted) return
    lifetime.abort()
    stream.destroy()
    for (const pending of waiting.values()) pending.reject(new DesktopSyncUnavailable())
    waiting.clear()
    listeners.clear()
  }
  readFrames(stream, (packet) => {
    if (typeof packet === "object" && packet !== null && "event" in packet) {
      const event = desktopSyncEvent.parse(packet)
      if (child === undefined || event.child !== child) throw new DesktopSyncUnavailable()
      for (const listener of listeners) listener(event)
      if (event.event === "retired") close()
      return
    }
    const reply = desktopSyncReply.parse(packet)
    const pending = waiting.get(reply.id)
    if (pending === undefined) throw new DesktopSyncUnavailable()
    waiting.delete(reply.id)
    if (reply.ok) pending.resolve(reply.value)
    else pending.reject(new DesktopSyncUnavailable())
  }, close)
  // Not async: the authority's admission callback must enclose the immediate write.
  const request = (packet: Readonly<Record<string, unknown>>): Promise<unknown> => {
    if (lifetime.signal.aborted || waiting.size >= 64 || nextId >= 0x7fffffff) return Promise.reject(new DesktopSyncUnavailable())
    const id = ++nextId
    const pending = Promise.withResolvers<unknown>()
    waiting.set(id, pending)
    try {
      writeFrame(stream, { id, ...packet })
    } catch {
      close()
    }
    return pending.promise
  }
  const timeout = setTimeout(close, 10_000)
  timeout.unref()
  try {
    child = desktopSyncChild.parse(await request({ op: "bootstrap" })).child
    if (lifetime.signal.aborted) throw new DesktopSyncUnavailable()
    return {
      kind: "connected",
      channel: {
        signal: lifetime.signal,
        close,
        onEvent(listener) {
          if (!lifetime.signal.aborted) listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        request(packet) {
          const parsed = desktopSyncRequest.safeParse(packet)
          if (!parsed.success) return Promise.reject(new DesktopSyncUnavailable())
          return request({ op: "request", capability: child, request: parsed.data })
        },
      },
    }
  } catch {
    close()
    return { kind: "unavailable", reason: "private_channel_unavailable" }
  } finally {
    clearTimeout(timeout)
  }
}
