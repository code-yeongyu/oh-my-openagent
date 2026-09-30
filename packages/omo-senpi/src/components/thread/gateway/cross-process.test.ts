import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { connect, createServer } from "node:net"
import { join } from "node:path"

import { createInboxDrain } from "./drain"
import { gatewayInboxDirectory } from "./paths"
import { createGatewayHarness, type GatewayHarness, type HarnessSession } from "./testing/harness"
import type { GatewayStoreEvent, GatewayStoreTestHooks } from "./types"

const SENDER = new URL("./testing/sender-process.ts", import.meta.url).pathname
const STEP_TIMEOUT_MS = 20_000

let harness: GatewayHarness | undefined
const children: ReturnType<typeof Bun.spawn>[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGCONT")
      child.kill("SIGKILL")
      await child.exited
    }
  }
  await harness?.dispose()
  harness = undefined
})

function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${STEP_TIMEOUT_MS} ms for ${label}, it never happened`)), STEP_TIMEOUT_MS)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

/** The one inbox marker the sender wrote for `target`; the store writes it before either commit hook runs. */
function inboxMarker(h: GatewayHarness, target: string): string {
  const [only, ...rest] = readdirSync(gatewayInboxDirectory(h.agentDir, target)).filter((name) => !name.startsWith("."))
  if (only === undefined || rest.length > 0) throw new Error(`expected exactly one inbox marker for ${target}, found ${JSON.stringify(rest.length > 0 ? [only, ...rest] : [])}`)
  return only
}

function nextStoreEvent(session: HarnessSession, kind: GatewayStoreEvent["kind"]): Promise<GatewayStoreEvent> {
  return new Promise((resolve) => {
    const stop = session.store.onEvent((event) => {
      if (event.kind !== kind) return
      stop()
      resolve(event)
    })
  })
}

type SenderHandle = {
  readonly child: ReturnType<typeof Bun.spawn>
  readonly line: (prefix: string) => Promise<string>
  readonly send: (line: string) => void
}

function spawnSender(h: GatewayHarness, hooks: GatewayStoreTestHooks): SenderHandle {
  const child = Bun.spawn([process.execPath, SENDER, JSON.stringify({ agentDir: h.agentDir, sender: "A", target: "B", text: "from another process", hooks })], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  children.push(child)
  const seen: string[] = []
  const waiters: { readonly prefix: string; readonly resolve: (line: string) => void }[] = []
  void (async () => {
    let buffered = ""
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
      buffered += new TextDecoder().decode(chunk)
      let newline = buffered.indexOf("\n")
      while (newline >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        seen.push(line)
        for (const waiter of waiters.splice(0)) {
          if (line.startsWith(waiter.prefix)) waiter.resolve(line)
          else waiters.push(waiter)
        }
        newline = buffered.indexOf("\n")
      }
    }
  })()
  return {
    child,
    line: (prefix) => {
      const found = seen.find((line) => line.startsWith(prefix))
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => waiters.push({ prefix, resolve }))
    },
    send: (line) => {
      const stdin = child.stdin as { write(text: string): unknown; flush(): unknown }
      stdin.write(`${line}\n`)
      stdin.flush()
    },
  }
}

describe("sender_death_before_wake", () => {
  test("#given the sender is SIGKILLed the instant COMMIT returns #when the idle receiver's inbox watch fires #then its barrier pass applies the row exactly once with no other trigger", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B")
    const sender = spawnSender(h, { afterDbCommit: "sigkill" })
    expect(await within(sender.child.exited, "the sender to die")).not.toBe(0)
    expect(sender.child.signalCode).toBe("SIGKILL")
    const deliveryId = inboxMarker(h, "B")
    const drained = b.drain.drain({ reason: "inbox" })
    expect((await within(drained, "the receiver drain")).admitted).toEqual([{ delivery_id: deliveryId, kind: "started" }])
    await h.quiesce()
    const rows = await b.store.list({ target_durable_id: "B" })
    expect({ rows: rows.map((row) => [row.delivery_id, row.state]), entries: b.runtime.transcriptEntries(deliveryId) }).toEqual({ rows: [[deliveryId, "applied"]], entries: 1 })
  })

  test("#given the sender is SIGKILLed one statement earlier, with its marker written and COMMIT not run #when the receiver drains #then the row is absent, the dead writer's marker is removed, and nothing is delivered", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B")
    const sender = spawnSender(h, { beforeDbCommit: "sigkill" })
    await within(sender.child.exited, "the sender to die")
    const deliveryId = inboxMarker(h, "B")
    await within(b.drain.drain({ reason: "inbox" }), "the receiver drain")
    expect({
      rows: await b.store.list({ target_durable_id: "B" }),
      marker: existsSync(join(gatewayInboxDirectory(h.agentDir, "B"), deliveryId)),
      enqueued: b.runtime.enqueueCalls.length,
    }).toEqual({ rows: [], marker: false, enqueued: 0 })
  })
})

describe("notification_before_publication_barrier", () => {
  test("#given the sender is paused inside its write transaction after the INSERT and marker #when the receiver's drain reaches its barrier and the sender commits then dies #then the drain sees the row only after the commit and applies it once", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B", { storeOptions: { _test: { announceBarrier: true } } })
    const sender = spawnSender(h, { beforeDbCommit: "pause", afterDbCommit: "sigkill" })
    await within(sender.line("PAUSED beforeDbCommit"), "the sender to pause inside its transaction")
    const deliveryId = inboxMarker(h, "B")
    const barrier = nextStoreEvent(b, "barrier")
    let settled = false
    const drained = b.drain.drain({ reason: "inbox" }).finally(() => {
      settled = true
    })
    await within(barrier, "the receiver to reach BEGIN IMMEDIATE")
    expect(settled).toBe(false)
    sender.send("RESUME beforeDbCommit")
    await within(sender.child.exited, "the sender to commit and die")
    expect(sender.child.signalCode).toBe("SIGKILL")
    expect((await within(drained, "the receiver drain")).admitted).toEqual([{ delivery_id: deliveryId, kind: "started" }])
    await h.quiesce()
    expect({ state: (await b.store.deliveryView(deliveryId))?.row.state, entries: b.runtime.transcriptEntries(deliveryId) }).toEqual({ state: "applied", entries: 1 })
  })
})

describe("drain_busy_retry_past_the_lock_wait_bound", () => {
  test("#given a sender SIGSTOPped holding the write lock past the store's lock-wait bound #when the drain gives up and the sender continues #then the drain's own busy retry admits the row with no other trigger, and it ends applied exactly once", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B", { storeOptions: { _test: { busyTimeoutMs: 100, lockWaitMaxMs: 600 } } })
    const sender = spawnSender(h, { beforeDbCommit: "pause" })
    await within(sender.line("PAUSED beforeDbCommit"), "the sender to pause inside its transaction")
    sender.child.kill("SIGSTOP")
    const deliveryId = inboxMarker(h, "B")
    let admittedBy!: (id: string) => void
    const admitted = new Promise<string>((resolve) => { admittedBy = resolve })
    const logs: string[] = []
    const drain = createInboxDrain({ store: b.store, runtime: b.runtime, durableId: "B", sessionPath: () => b.runtime.sessionPath, now: () => h.clock.now, log: (line) => logs.push(line), onAdmitted: admittedBy })
    try {
      const exceeded = nextStoreEvent(b, "lock_wait_exceeded")
      const failed = await within(drain.drain({ reason: "inbox" }).then(() => null, (error: unknown) => error), "the first drain pass to give up at the lock-wait bound")
      expect(String(failed)).toContain("lock wait exceeded")
      await within(exceeded, "the lock_wait_exceeded store event")
      sender.child.kill("SIGCONT")
      sender.send("RESUME beforeDbCommit")
      expect(await within(sender.line("DONE "), "the sender to commit")).toContain("\"queued_offline\"")
      expect(await within(admitted, "the drain's busy retry to admit the row with no other trigger")).toBe(deliveryId)
      await h.quiesce()
      expect({ state: (await b.store.deliveryView(deliveryId))?.row.state, enqueued: b.runtime.enqueueCount(deliveryId), entries: b.runtime.transcriptEntries(deliveryId) }).toEqual({ state: "applied", enqueued: 1, entries: 1 })
      expect(logs.some((line) => line.includes("retrying"))).toBe(true)
    } finally {
      drain.stop()
    }
  }, 60_000)
})

describe("suspended_writer_busy_retry", () => {
  test("#given the sender is SIGSTOPped holding the write lock #when the receiver's drain hits BUSY #then the receiver's loop keeps answering, and after SIGCONT the single retry applies the row once", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B", { storeOptions: { _test: { busyTimeoutMs: 200 } } })
    const sender = spawnSender(h, { beforeDbCommit: "pause" })
    await within(sender.line("PAUSED beforeDbCommit"), "the sender to pause inside its transaction")
    sender.child.kill("SIGSTOP")
    const deliveryId = inboxMarker(h, "B")
    const busy = nextStoreEvent(b, "busy")
    let settled = false
    const drained = b.drain.drain({ reason: "inbox" }).finally(() => {
      settled = true
    })
    await within(busy, "the receiver's BEGIN IMMEDIATE to report BUSY")

    const socket = join(h.agentDir, "t.sock")
    const server = createServer((connection) => connection.end(`${JSON.stringify({ type: "response", command: "get_state", success: true })}\n`))
    await new Promise<void>((resolve) => server.listen(socket, resolve))
    try {
      const reply = await within(new Promise<string>((resolve, reject) => {
        let text = ""
        const client = connect(socket)
        client.on("data", (chunk) => {
          text += chunk.toString()
        })
        client.on("end", () => resolve(text))
        client.on("error", reject)
      }), "a get_state answer while the lock is held")
      expect(JSON.parse(reply).success).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    expect(settled).toBe(false)

    sender.child.kill("SIGCONT")
    sender.send("RESUME beforeDbCommit")
    expect(await within(sender.line("DONE "), "the sender to commit")).toContain("\"queued_offline\"")
    expect((await within(drained, "the receiver's retry")).admitted).toEqual([{ delivery_id: deliveryId, kind: "started" }])
    await h.quiesce()
    expect({ state: (await b.store.deliveryView(deliveryId))?.row.state, entries: b.runtime.transcriptEntries(deliveryId) }).toEqual({ state: "applied", entries: 1 })
  })
})
