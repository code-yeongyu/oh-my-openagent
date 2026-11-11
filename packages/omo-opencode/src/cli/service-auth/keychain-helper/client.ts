import { z } from "zod"

import { spawn } from "../../../shared/bun-spawn-shim"

export type HelperVerb = "read" | "approve" | "write" | "stage" | "retire" | "promote" | "remove"
export type HelperCall = { readonly verb: HelperVerb; readonly account: string; readonly value?: string }

const MUTATING: ReadonlySet<HelperVerb> = new Set(["write", "stage", "retire", "promote", "remove"])

const helperReplySchema = z
  .object({
    owned: z.boolean(),
    value: z.string(),
    marker: z.boolean(),
    cdat: z.number(),
    mdat: z.number(),
    partition: z.enum(["ours", "other", "none", "unknown"]),
    // oldSlots is absent from helpers released before the eight-slot retire (v5.1.52 to v5.1.60): their one slot is `.old`.
    present: z
      .object({ staging: z.boolean(), old: z.boolean(), oldSlots: z.array(z.number().int().min(0).max(7)).optional() })
      .strict(),
    missing: z.boolean(),
    recover: z.boolean(),
    ok: z.boolean(),
    created: z.boolean(),
    skipped: z.boolean(),
    slot: z.number().int().min(0).max(7),
    error: z.enum(["locked", "store", "not-owned", "exists", "missing", "denied", "refused"]),
    reason: z.string(),
    status: z.number(),
  })
  .partial()
  .strict()
export type HelperReply = z.infer<typeof helperReplySchema>

/** The session-lock lease of team-core (`withLock`'s callback argument), narrowed to what a helper call needs. */
export type HelperLease = { readonly handOver: (pid: number) => Promise<void>; readonly restore: () => Promise<void> }

export type SpawnedHelper = {
  readonly pid: number
  readonly send: (line: string) => void
  readonly reply: Promise<string | null>
  readonly close: () => void
}
export type HelperSpawner = (path: string) => SpawnedHelper

export class HelperProtocolError extends Error {}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const newline = text.indexOf("\n")
    if (newline !== -1) return text.slice(0, newline)
    const chunk = await reader.read()
    if (chunk.done) return null
    text += decoder.decode(chunk.value, { stream: true })
  }
}

function isFlushable(stream: NodeJS.WritableStream): stream is NodeJS.WritableStream & { flush(): unknown } {
  return typeof (stream as { flush?: unknown }).flush === "function"
}

// Detached: the helper gets its own POSIX session, so a signal aimed at the client's process group never reaches it,
// and a client killed mid-call leaves the helper to finish its native call, read EOF and exit (design 2, 3.6 R2).
export const spawnDetachedHelper: HelperSpawner = (path) => {
  const child = spawn([path], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    detached: true,
    env: process.env.HOME === undefined ? {} : { HOME: process.env.HOME },
  })
  const pid = child.pid
  if (pid === undefined) throw new HelperProtocolError("The keychain helper did not start.")
  const stdin = child.stdin
  return {
    pid,
    send: (line) => {
      stdin.write(line)
      // Bun's pipe sink buffers until flushed; a Node stream writes through on its own.
      if (isFlushable(stdin)) stdin.flush()
    },
    reply: firstLine(child.stdout),
    close: () => {
      stdin.end()
    },
  }
}

/**
 * One helper process per call. A mutating call runs only under the session lock: the lock is handed to the helper
 * before the request and restored before its stdin closes, so no other writer can enter until the native call has
 * landed (design 3.6, R2). `restore` throws when the lock was lost, and the caller's section must stop.
 */
export async function callHelper(
  path: string,
  call: HelperCall,
  options: { readonly lease?: HelperLease; readonly spawn?: HelperSpawner } = {},
): Promise<HelperReply> {
  const mutates = MUTATING.has(call.verb)
  if (mutates && options.lease === undefined)
    throw new HelperProtocolError(`The ${call.verb} helper call needs the session lock.`)
  const helper = (options.spawn ?? spawnDetachedHelper)(path)
  let handedOver = false
  try {
    if (mutates && options.lease !== undefined) {
      await options.lease.handOver(helper.pid)
      handedOver = true
    }
    helper.send(
      `${JSON.stringify({ v: 1, verb: call.verb, account: call.account, ...(call.value === undefined ? {} : { value: call.value }) })}\n`,
    )
    const line = await helper.reply
    if (handedOver && options.lease !== undefined) {
      handedOver = false
      await options.lease.restore()
    }
    if (line === null) throw new HelperProtocolError(`The keychain helper exited without answering ${call.verb}.`)
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      throw new HelperProtocolError(`The keychain helper sent a ${call.verb} reply that is not JSON.`)
    }
    const parsed = helperReplySchema.safeParse(json)
    if (!parsed.success) throw new HelperProtocolError(`The keychain helper sent an unexpected ${call.verb} reply.`)
    return parsed.data
  } catch (error) {
    if (handedOver && options.lease !== undefined) {
      try {
        await options.lease.restore()
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `The ${call.verb} helper call failed and the session lock could not be restored.`,
        )
      }
    }
    throw error
  } finally {
    helper.close()
  }
}
