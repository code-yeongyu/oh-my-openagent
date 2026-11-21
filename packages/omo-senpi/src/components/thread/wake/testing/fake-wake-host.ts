import { once } from "node:events"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { join } from "node:path"

import { fakeHostTransport } from "../../../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { testBudgetSignal } from "../../../../../../../test-support/test-deadline"

export type WakeHostFrame = Readonly<Record<string, unknown>>

export type WakeHostReply = Readonly<Record<string, unknown>>

export type FakeWakeHost = {
  readonly socketPath: string
  readonly frames: WakeHostFrame[]
  readonly close: () => Promise<void>
}

/**
 * A legacy engine host on a real socket, over the task engine's fake transport: it answers `get_protocol_info` with no
 * capabilities and every other frame with `respond`, so a test reads the frames exactly as the host received them.
 */
export async function startFakeWakeHost(
  respond: (frame: WakeHostFrame, index: number) => WakeHostReply,
): Promise<FakeWakeHost> {
  const directory = mkdtempSync("/tmp/wake-host-")
  const socketPath = join(directory, "rpc.sock")
  const frames: WakeHostFrame[] = []
  const sockets = new Set<Socket>()
  const transport = fakeHostTransport(socketPath)
  const server = createServer((socket) =>
    transport.authenticate(socket, () => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const frame = JSON.parse(buffer.slice(0, newline)) as WakeHostFrame
          buffer = buffer.slice(newline + 1)
          const reply =
            frame.type === "get_protocol_info" ? { success: true, data: {} } : respond(frame, frames.push(frame) - 1)
          socket.write(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, ...reply })}\n`)
        }
      })
    }),
  )
  const listening = once(server, "listening", { signal: testBudgetSignal("fake wake host to emit 'listening'") })
  server.listen(transport.listenAddress)
  await listening
  return {
    socketPath,
    frames,
    close: async () => {
      const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
      for (const socket of sockets) socket.destroy()
      server.close()
      await closed
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

/** Writes a session file the way the engine names it (`<sessions>/<project dir>/<timestamp>_<id>.jsonl`), header first. */
export function writeSessionFile(
  sessionsDirectory: string,
  durableId: string,
  header: Readonly<Record<string, unknown>> = {},
  projectDirectory = "--tmp-project--",
): string {
  const directory = join(sessionsDirectory, projectDirectory)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `2026-11-12T00-00-00-000Z_${durableId}.jsonl`)
  const line = {
    type: "session",
    version: 3,
    id: durableId,
    timestamp: "2026-11-12T00:00:00.000Z",
    cwd: "/work/project",
  }
  writeFileSync(path, `${JSON.stringify({ ...line, ...header })}\n`)
  return path
}

/**
 * The two transcript entries senpi's effect ledger writes for an `unload_session` carrying an `effectId`
 * (`effect-ledger.ts`, `rpcEffectRecordSchema`): `accepted` before it is applied, then `done` (or `failed` for a refused
 * unload) as the session is torn down.
 */
export function recordUnloadEffect(path: string, durableId: string, at: number, state: "done" | "failed"): void {
  const effect = (entryState: string, iso: string) => ({
    type: "custom",
    customType: "rpc_effect",
    id: `e-${entryState}-${at}`,
    parentId: null,
    timestamp: iso,
    data: {
      effectId: `omo-thread-close:${at}`,
      kind: "unload",
      state: entryState,
      ...(entryState === "done" ? { disposition: "unloaded" } : {}),
      by: { connectionId: "c-1" },
      acceptedAt: new Date(at - 5).toISOString(),
      updatedAt: iso,
      durableSessionId: durableId,
      fingerprint: "f",
    },
  })
  appendFileSync(path, `${JSON.stringify(effect("accepted", new Date(at - 5).toISOString()))}\n`)
  appendFileSync(path, `${JSON.stringify(effect(state, new Date(at).toISOString()))}\n`)
}
