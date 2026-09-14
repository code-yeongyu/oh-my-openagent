import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { patchRpcCloseOrdering } from "../bin/lib/rpc-close-ordering.js"

const rpcRoot = join(import.meta.dir, "../../../node_modules/@code-yeongyu/senpi/dist/modes/rpc")
const wireRecord = z.object({ type: z.string(), command: z.string().optional() })

// Only the scheduling boundary is injected. Registry, router and JSONL writer
// execute the installed engine; a close deadline cannot stand in for worker exit.
async function registryWithScheduler() {
  const root = await mkdtemp(join(tmpdir(), "omo-close-order-"))
  const path = join(rpcRoot, "worker-session-registry.js")
  const copied = join(root, "dist/modes/rpc/worker-session-registry.js")
  await mkdir(join(root, "dist/modes/rpc"), { recursive: true })
  await writeFile(copied, await readFile(path, "utf8"))
  patchRpcCloseOrdering(root)
  const source = (await readFile(copied, "utf8"))
    .replace(/from "([^"]+)"/g, (_match, specifier: string) => `from ${JSON.stringify(import.meta.resolve(specifier, path))}`)
    .replace("export class WorkerSessionRegistry", "export function withScheduler(setTimeout) { return class WorkerSessionRegistry")
  await writeFile(join(root, "registry.mjs"), `${source}\n}\n`)
  const { withScheduler } = await import(pathToFileURL(join(root, "registry.mjs")).href)
  return { withScheduler, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

const turnBoundary = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("RPC close publication", () => {
  test("lists no session at either terminal record when the grace deadline precedes worker exit", async () => {
    // Given an open session whose worker stays live past the grace deadline.
    await using loaded = await registryWithScheduler()
    const [{ SessionCommandRouter }, { SessionEventWriter }] = await Promise.all([
      import(`${rpcRoot}/session-command-router.js`),
      import(`${rpcRoot}/session-event-writer.js`),
    ])
    const deadlines: Array<() => void> = []
    const Registry = loaded.withScheduler((callback: () => void) => { deadlines.push(callback) })
    const registry = new Registry({ configuration: {}, closeGraceMs: 1, now: () => 0 })
    const exit = Promise.withResolvers<void>()
    const closeStarted = Promise.withResolvers<void>()
    const entry = {
      state: "open", attachments: 1, cwd: tmpdir(),
      worker: { close: () => { closeStarted.resolve(); return exit.promise } },
    }
    registry.entries.set("rpc-test", entry)
    const records: object[] = []
    const observations: Array<Promise<unknown>> = []
    const writer = new SessionEventWriter((line: string) => {
      const record = wireRecord.parse(JSON.parse(line))
      records.push(record)
      if (record.type === "session_closed" || record.command === "close_session") {
        observations.push(router.handle(JSON.parse('{"type":"list_sessions","id":"immediate"}')))
      }
    })
    const router = new SessionCommandRouter(registry, writer, { cwd: tmpdir() })
    try {
      // When the transport's close deadline fires, with exit held until the next
      // event-loop turn. This is a scheduler seam, not a wall-clock delay/retry.
      const closing = router.handle(JSON.parse('{"type":"close_session","sessionId":"rpc-test","id":"close"}'))
      await closeStarted.promise
      for (const expire of deadlines) expire()
      await turnBoundary()
      await writer.flush()
      const beforeExit = records.length
      const retainedBeforeExit = registry.list().length
      const completion = registry.peek("rpc-test").closeResolve
      registry.entries.delete("rpc-test")
      completion()
      exit.resolve()
      await closing
      await writer.flush()

      // Then success and session_closed publish only after observable removal.
      expect(beforeExit).toBe(0)
      expect(retainedBeforeExit).toBe(1)
      expect(records).toEqual([
        { type: "session_closed" },
        { type: "response", command: "close_session" },
      ])
      expect(await Promise.all(observations)).toEqual([
        { id: "immediate", type: "response", command: "list_sessions", success: true, data: { sessions: [] } },
        { id: "immediate", type: "response", command: "list_sessions", success: true, data: { sessions: [] } },
      ])
    } finally {
      exit.resolve()
      await router.dispose()
    }
  })

  test("keeps the session when close only releases one of two attachments", async () => {
    // Given two attachments to the same session.
    await using loaded = await registryWithScheduler()
    const [{ SessionCommandRouter }, { SessionEventWriter }] = await Promise.all([
      import(`${rpcRoot}/session-command-router.js`),
      import(`${rpcRoot}/session-event-writer.js`),
    ])
    const Registry = loaded.withScheduler(() => { throw new Error("attachment release scheduled teardown") })
    const registry = new Registry({ configuration: {}, closeGraceMs: 1, now: () => 0 })
    registry.entries.set("rpc-test", { state: "open", attachments: 2, cwd: tmpdir() })
    const records: object[] = []
    const writer = new SessionEventWriter((line: string) => records.push(wireRecord.parse(JSON.parse(line))))
    const router = new SessionCommandRouter(registry, writer, { cwd: tmpdir() })
    try {
      // When one attachment closes.
      await router.handle(JSON.parse('{"type":"close_session","sessionId":"rpc-test","id":"detach"}'))
      await writer.flush()
      // Then no terminal session event is emitted and the other attachment lives.
      expect(records).toEqual([{ type: "response", command: "close_session" }])
      expect(registry.list()).toEqual([{ sessionId: "rpc-test", cwd: tmpdir(), status: "open" }])
    } finally {
      registry.entries.clear()
      await router.dispose()
    }
  })
})
