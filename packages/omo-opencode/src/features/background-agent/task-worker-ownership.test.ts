import { expect, test } from "bun:test"
import { once } from "node:events"
import { createServer } from "node:http"
import { Worker } from "node:worker_threads"
import { TaskOwnerSchema } from "./task-recovery-store"
import { probeTaskOwner, TaskWorkerOwnership } from "./task-worker-ownership"

test("worker responder disappears on actual Bun worker termination while enclosing PID survives", async () => {
  const worker = new Worker(new URL("./task-worker-ownership.test-worker.ts", import.meta.url))
  const ready = once(worker, "message", { signal: AbortSignal.timeout(5000) })
  try {
    const [message] = await ready
    const owner = TaskOwnerSchema.parse(message)
    const record = { owner, sessionId: "worker-child", generation: crypto.randomUUID() }
    expect(await probeTaskOwner(record)).toBe("owned")
    const exited = once(worker, "exit", { signal: AbortSignal.timeout(5000) })
    await worker.terminate()
    await exited
    process.kill(process.pid, 0)
    expect(await probeTaskOwner(record)).toBe("dead")
  } finally {
    await worker.terminate()
  }
})

test("reachable live owners remain owned even when the child is idle", async () => {
  const worker = new TaskWorkerOwnership(async () => "owned")
  try {
    const owner = await worker.open()
    expect(await probeTaskOwner({ owner, sessionId: "idle-child", generation: crypto.randomUUID() })).toBe("owned")
    expect(await probeTaskOwner({ owner: { ...owner, id: crypto.randomUUID() }, sessionId: "idle-child", generation: crypto.randomUUID() })).toBe("unknown")
  } finally { worker.close() }
})

test("a reused endpoint with malformed reply is unknown rather than proof of death", async () => {
  const worker = new TaskWorkerOwnership(async () => "unknown")
  const owner = await worker.open()
  worker.close()
  const server = createServer((_request, response) => response.end("invalid"))
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(owner.port, "127.0.0.1")
  await listening
  try {
    expect(await probeTaskOwner({ owner, sessionId: "child", generation: crypto.randomUUID() })).toBe("unknown")
  } finally { server.closeAllConnections(); server.close() }
})

test("an owner that does not answer is unknown rather than proof of death", async () => {
  const worker = new TaskWorkerOwnership(async () => "unknown")
  const owner = await worker.open()
  worker.close()
  const server = createServer(() => undefined)
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(owner.port, "127.0.0.1")
  await listening
  try {
    expect(await probeTaskOwner({ owner, sessionId: "child", generation: crypto.randomUUID() })).toBe("unknown")
  } finally { server.closeAllConnections(); server.close() }
})
