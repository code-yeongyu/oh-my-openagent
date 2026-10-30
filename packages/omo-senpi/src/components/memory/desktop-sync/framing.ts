import type { Duplex } from "node:stream"
import { DesktopSyncUnavailable } from "./protocol"

// Matches the private desktop wire: ciphertext plus canonical base64url overhead.
const MAX_FRAME_BYTES = 92 * 1024 * 1024
const BINARY_TAG = "$omoSyncBytes"

export function writeFrame(stream: Duplex, packet: unknown): void {
  if (stream.destroyed || !stream.writable || stream.writableLength > MAX_FRAME_BYTES) throw new DesktopSyncUnavailable()
  const line = JSON.stringify(packet, function (this: Record<string, unknown>, key, item: unknown) {
    const original = this[key]
    return original instanceof Uint8Array ? { [BINARY_TAG]: Buffer.from(original).toString("base64url") } : item
  })
  if (line === undefined || Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new DesktopSyncUnavailable()
  stream.write(`${line}\n`)
}

export function readFrames(stream: Duplex, receive: (packet: unknown) => void, closed: () => void): void {
  let pending = Buffer.alloc(0)
  let ended = false
  const close = () => {
    if (ended) return
    ended = true
    pending = Buffer.alloc(0)
    closed()
  }
  stream.on("data", (chunk: Buffer) => {
    if (ended) return
    try {
      // Consume a chunk a frame at a time so even one very large write cannot bypass the buffer limit.
      let offset = 0
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset)
        const end = newline < 0 ? chunk.length : newline
        if (pending.length + end - offset > MAX_FRAME_BYTES) throw new DesktopSyncUnavailable()
        pending = Buffer.concat([pending, chunk.subarray(offset, end)])
        if (newline < 0) return
        const value: unknown = JSON.parse(pending.toString("utf8"), (_key, item: unknown) => {
          if (typeof item !== "object" || item === null || Object.keys(item).length !== 1 || !(BINARY_TAG in item)) return item
          const encoded = item[BINARY_TAG]
          if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]*$/u.test(encoded)) throw new DesktopSyncUnavailable()
          const bytes = Buffer.from(encoded, "base64url")
          if (bytes.toString("base64url") !== encoded) throw new DesktopSyncUnavailable()
          return new Uint8Array(bytes)
        })
        pending = Buffer.alloc(0)
        receive(value)
        if (ended || stream.destroyed) return
        offset = newline + 1
      }
    } catch {
      // Untrusted framing boundary: neither parser errors nor input bytes leave this channel.
      close()
    }
  })
  stream.once("error", close)
  stream.once("end", close)
  stream.once("close", close)
}
