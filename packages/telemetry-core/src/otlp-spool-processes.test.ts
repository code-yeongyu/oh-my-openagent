import { afterEach, describe, expect, test } from "bun:test"
import { utimesSync } from "node:fs"
import { join } from "node:path"

import { CLAIM_LEASE_MS, createBatchId } from "./otlp-spool-dir"
import { startCollectorStub, type CollectorStub } from "./otlp-spool-server"
import { capture, createSpoolRoot, makeTransport, spoolNames } from "./otlp-test-support"

const CHILD = join(import.meta.dir, "otlp-spool-child.ts")
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-processes-")
  cleanups.push(created.cleanup)
  return created.dir
}

function stub(reply: Parameters<typeof startCollectorStub>[0]): CollectorStub {
  const started = startCollectorStub(reply)
  cleanups.push(started.stop)
  return started
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}`)), ms).unref?.()
    }),
  ])
}

function lines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return async (ms: number, what: string): Promise<string> => {
    while (!buffer.includes("\n")) {
      const chunk = await within(reader.read(), ms, what)
      if (chunk.done) throw new Error(`child exited before ${what}: ${buffer}`)
      buffer += decoder.decode(chunk.value)
    }
    const at = buffer.indexOf("\n")
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    return line
  }
}

function spawnChild(args: readonly string[]) {
  const child = Bun.spawn([process.execPath, CHILD, ...args], { stdin: "pipe", stdout: "pipe", stderr: "inherit" })
  cleanups.push(() => child.kill("SIGKILL"))
  return { child, next: lines(child.stdout) }
}

async function deadPid(): Promise<number> {
  const short = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await short.exited
  return short.pid
}

function ids(count: number): string[] {
  return Array.from({ length: count }, () => Bun.randomUUIDv7())
}

describe("spool claims across real processes", () => {
  test("#given two live processes sweeping one spool of sealed batches and dead-owner active files #then every record is sent exactly once and the spool ends empty", async () => {
    // given
    const dir = root()
    const pid = await deadPid()
    const sealed = ids(40)
    const active = ids(20)
    const owner = makeTransport(dir, { pid, bootId: "d".repeat(32), flushAt: 1_000 })
    for (const id of sealed) {
      capture(owner, "feature_used", { event_id: id })
      owner.providers.logWriter.seal(createBatchId(Date.now()))
    }
    const idle = new Date(Date.now() - 600_000)
    active.forEach((id, index) => {
      const writer = makeTransport(dir, { pid, bootId: index.toString(16).padStart(32, "a"), flushAt: 1_000 })
      capture(writer, "feature_used", { event_id: id })
      writer.providers.logWriter.close()
    })
    for (const name of spoolNames(dir).filter((n) => n.startsWith("active-"))) utimesSync(join(dir, name), idle, idle)
    const server = stub("ok")
    const racers = [spawnChild(["race", dir, server.endpoint, String(pid)]), spawnChild(["race", dir, server.endpoint, String(pid)])]

    // when
    for (const racer of racers) racer.child.stdin.write("g")
    for (const racer of racers) racer.child.stdin.flush()
    const done = await Promise.all(racers.map((racer) => racer.next(90_000, "racer DONE")))
    const sentByEach = done.map((line) => Number(line.split(" ")[1]))

    // then
    expect(done.every((line) => line.startsWith("DONE "))).toBe(true)
    expect(sentByEach.reduce((sum, sent) => sum + sent, 0)).toBe(60)
    expect(server.accepted.length).toBe(60)
    expect([...server.accepted].sort()).toEqual([...sealed, ...active].sort())
    expect(spoolNames(dir)).toEqual([])
  }, 120_000)

  test("#given a claimer killed with SIGKILL mid-send #when another process starts after the 5 min lease #then it reclaims and sends the batch once and no claim file remains", async () => {
    // given
    const dir = root()
    const events = ids(5)
    const server = stub("hang")
    const firstRequest = server.nextRequest()
    const { child } = spawnChild(["hang", dir, server.endpoint, ...events])
    await within(firstRequest, 30_000, "the claimer's request")
    child.kill("SIGKILL")
    await child.exited
    const orphan = spoolNames(dir)
    server.reply = "ok"

    // when
    const later = makeTransport(dir, { endpoint: server.endpoint, fetch, autoStart: true, nowMs: () => Date.now() + CLAIM_LEASE_MS + 1 })
    await later.ready
    await later.shutdown()

    // then
    expect(orphan).toEqual([expect.stringMatching(/^batch-logs-[0-9a-f-]{36}\.sending-[0-9a-f]{32}-[0-9]+$/)])
    expect([...server.accepted].sort()).toEqual([...events].sort())
    expect(spoolNames(dir)).toEqual([])
  }, 60_000)

  test("#given a hung-but-alive claimer whose lease expired #when another live process reclaims and sends the batch #then the resumed claimer does not send it again", async () => {
    // given
    const dir = root()
    const events = ids(5)
    const server = stub("unavailable")
    const { child, next } = spawnChild(["stall", dir, server.endpoint, ...events])
    expect(await next(30_000, "the claimer to stall in its retry pause")).toBe("STALLED")
    server.reply = "ok"

    // when
    const other = makeTransport(dir, { endpoint: server.endpoint, fetch, autoStart: true, nowMs: () => Date.now() + CLAIM_LEASE_MS + 1 })
    await other.ready
    await other.shutdown()
    child.stdin.write("r")
    child.stdin.flush()
    const flushed = await next(30_000, "the resumed claimer to finish")
    await child.exited

    // then
    expect(flushed).toBe("FLUSHED 1")
    expect(server.accepted.length).toBe(events.length)
    expect([...server.accepted].sort()).toEqual([...events].sort())
    expect(spoolNames(dir)).toEqual([])
  }, 60_000)
})
