import { createHash } from "node:crypto"

import type { CommandBlobRef, JsonObject, LocalEvent } from "./local-api/protocol.ts"

// One device's delegated command channel on this local API connection (decision 0018, docs/local-api.md "Delegated
// commands"): the engine's reply to each delegated command, and the frames the engine writes unasked on that
// connection. A body too large for one line arrives as a blob of its UTF-8 JSON and is checked against its declared
// length and sha256 before it is read. The attach feeds it from its own event listener, so an attach still holds
// exactly one subscription on the connection.
export type DelegatedChannel = {
  /** The engine's reply to a delegated command; it arrives before the command's final state. */
  readonly takeReply: (commandId: string) => JsonObject | undefined
  readonly onFrame: (listener: (frame: JsonObject) => void) => () => void
  /** A reply or frame that could not be read, or the channel closing; the reason is the service's or the check's. */
  readonly onLoss: (listener: (reason: string) => void) => () => void
  readonly accept: (event: LocalEvent) => void
  readonly stop: () => void
}

type Blob = { readonly ref: CommandBlobRef; readonly parts: Buffer[]; received: number }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function followDelegatedChannel(device: string): DelegatedChannel {
  const replies = new Map<string, JsonObject>()
  const frames = new Set<(frame: JsonObject) => void>()
  const losses = new Set<(reason: string) => void>()
  const blobs = new Map<string, Blob>()
  const lost = (reason: string): void => {
    for (const listener of [...losses]) listener(reason)
  }
  const body = (value: unknown): void => {
    if (!isObject(value)) return lost("a command event that is not an object")
    const frame = value["frame"]
    if (isObject(frame)) {
      for (const listener of [...frames]) listener(frame)
      return
    }
    const commandId = value["command_id"]
    const response = value["response"]
    if (typeof commandId === "string" && isObject(response)) replies.set(commandId, response)
    else lost("a command event with neither a frame nor a reply")
  }
  const accept = (event: LocalEvent): void => {
    switch (event.kind) {
      case "session.command_event":
        if (event.device !== device) return
        if ("blob" in event) blobs.set(event.blob.id, { ref: event.blob, parts: [], received: 0 })
        else body(event)
        return
      case "session.command_blob_chunk": {
        const blob = blobs.get(event.id)
        if (blob === undefined) return
        const bytes = Buffer.from(event.b, "base64")
        if (event.off !== blob.received || blob.received + bytes.length > blob.ref.bytes) {
          blobs.delete(event.id)
          return lost("a command event blob arrived out of order or over its length")
        }
        blob.parts.push(bytes)
        blob.received += bytes.length
        return
      }
      case "session.command_blob_done": {
        const blob = blobs.get(event.id)
        if (blob === undefined) return
        blobs.delete(event.id)
        const bytes = Buffer.concat(blob.parts)
        if (bytes.length !== blob.ref.bytes || createHash("sha256").update(bytes).digest("hex") !== blob.ref.sha256)
          return lost("a command event blob failed its length or sha256 check")
        let parsed: unknown
        try {
          parsed = JSON.parse(bytes.toString("utf8"))
        } catch {
          return lost("a command event blob is not JSON")
        }
        return body(parsed)
      }
      case "session.channel_closed":
        if (event.device !== device) return
        blobs.clear()
        return lost(`the delegated channel closed (${event.reason})`)
      default:
        return
    }
  }
  return {
    takeReply: commandId => {
      const reply = replies.get(commandId)
      replies.delete(commandId)
      return reply
    },
    onFrame: listener => {
      frames.add(listener)
      return () => frames.delete(listener)
    },
    onLoss: listener => {
      losses.add(listener)
      return () => losses.delete(listener)
    },
    accept,
    stop: () => {
      frames.clear()
      losses.clear()
      blobs.clear()
      replies.clear()
    },
  }
}
