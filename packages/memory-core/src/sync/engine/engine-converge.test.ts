import { afterEach, expect, test } from "bun:test"

import { awaitWithinTestBudget } from "../../../../../test-support/test-deadline"
import { createNodeGitExec } from "../../git/exec"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import type { CycleReport } from "./engine"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
let active: { readonly controller: AbortController; readonly settled: Promise<void> } | undefined

async function disposePair(): Promise<void> {
  // Bun can time out the test without cancelling its async body. Block new cycles and release
  // fake backoff waits so the in-flight cycle can actually finish before we dispose its fixture.
  active?.controller.abort()
  for (const d of devices) d.clock.releaseWaits()
  // A device still being set up will be registered before it checks the abort signal.
  await active?.settled
  active = undefined
  for (const d of devices.splice(0)) await d.dispose()
}

afterEach(disposePair, GIT_TEST_TIMEOUT)

interface Pair {
  readonly a: Device
  readonly b: Device
  readonly server: FakeSyncServer
  readonly cycle: (device: Device) => Promise<CycleReport>
}

function runPair(scenario: (pair: Pair) => Promise<void>): Promise<void> {
  const controller = new AbortController()
  const { signal } = controller
  const run = async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a")
    devices.push(a)
    signal.throwIfAborted()
    // Copy the pristine repo instead of running the same Git setup commands a second time.
    // makeDevice creates a separate store and journal for b.
    const b = await makeDevice(server, "b", undefined, { memoryFrom: a.repo.root })
    devices.push(b)
    signal.throwIfAborted()
    await scenario({
      a,
      b,
      server,
      cycle: (device) => {
        signal.throwIfAborted()
        // This promise covers the cycle's Git commit and checkpoint, unlike a head notification.
        return device.engine.runCycle()
      },
    })
  }
  const result = run().then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )
  active = { controller, settled: result.then(() => undefined) }
  return result.then((outcome) => {
    // Bun can kill an in-flight child when the test expires. The timeout has
    // already failed the test; do not reject its abandoned promise as well.
    if (!outcome.ok && !signal.aborted) throw outcome.error
  })
}

function testPair(name: string, scenario: (pair: Pair) => Promise<void>): void {
  test(name, () => runPair(scenario), GIT_TEST_TIMEOUT)
}

async function syncHistory(device: Device): Promise<string[]> {
  const { code, stdout, stderr } = await createNodeGitExec().run(
    ["log", "--format=%an%x09%(trailers:key=Sync-Seq,valueonly,separator=%x2C)", "HEAD"],
    { cwd: device.repo.root, timeoutMs: GIT_TEST_TIMEOUT },
  )
  if (code !== 0) throw new Error(`git log failed (${code}): ${stderr.trim()}`)
  return stdout.split("\n").filter((line) => line.split("\t")[1])
}

testPair("each direction converges in one cycle of the receiving device", async ({ a, b, cycle }) => {
  await a.write("notes/a.md", "from a\n")
  await cycle(a)
  await b.write("notes/b.md", "from b\n")
  const bReport = await cycle(b)
  expect(bReport).toMatchObject({ applied: 1, pushed: true })
  expect(await b.read("notes/a.md")).toBe("from a\n")
  await cycle(a)
  expect(await a.read("notes/b.md")).toBe("from b\n")
  expect(await a.read("notes/a.md")).toBe("from a\n")
})

testPair("concurrent edits to one file on two devices both survive", async ({ a, b, cycle }) => {
  await a.write("shared.md", "base\n")
  await cycle(a)
  await cycle(b)
  await a.write("shared.md", "a line\nbase\n")
  await b.write("shared.md", "b line\nbase\n")
  await cycle(a)
  await cycle(b)
  await cycle(a)
  const expected = "a line\nb line\nbase\n"
  expect([await a.read("shared.md"), await b.read("shared.md")]).toEqual([expected, expected])
})

testPair(
  "a sync commit names its seq range and is authored OmO Sync; nothing to apply commits nothing",
  async ({ a, b, cycle }) => {
    await a.write("x.md", "x\n")
    await cycle(a)
    await cycle(b)
    expect(await syncHistory(b)).toEqual(["OmO Sync\t1-1"])
    await cycle(b)
    expect(await syncHistory(b)).toEqual(["OmO Sync\t1-1"])
    expect(await syncHistory(a)).toEqual([])
  },
)

testPair("a replayed or duplicated delivery is a no-op", async ({ server, a, b, cycle }) => {
  await a.write("x.md", "one\n")
  await cycle(a)
  server.duplicateNextPage = true
  const first = await cycle(b)
  expect(first.applied).toBe(1)
  await b.restart()
  const state = await b.engine.state()
  expect(state.applied).toBe(1)
  expect(await cycle(b)).toMatchObject({ applied: 0, refused: 0 })
  expect(await b.read("x.md")).toBe("one\n")
  expect(await b.syncCommits()).toEqual(["1-1"])
})

testPair("a device's own pushed batch is not applied back to it", async ({ a, cycle }) => {
  await a.write("own.md", "mine\n")
  expect(await cycle(a)).toMatchObject({ pushed: true })
  expect(await cycle(a)).toMatchObject({ applied: 0, pushed: false })
  expect((await a.engine.state()).applied).toBe(1)
})

test("pair teardown joins a cycle already waiting on stale-base backoff", async () => {
  const waiting = Promise.withResolvers<Pair>()
  const pair = runPair(async (fixture) => {
    const { a, b, server, cycle } = fixture
    await a.write("a.md", "a\n")
    await b.write("b.md", "b\n")
    server.beforeNextAppend = async () => {
      await cycle(a)
    }
    const pending = b.clock.untilPending()
    const running = cycle(b)
    const backedOff = await Promise.race([pending.then(() => true), running.then(() => false)])
    if (!backedOff) throw new Error("cycle finished without scheduling stale-base backoff")
    waiting.resolve(fixture)
    await running
  })
  const { b, server } = await awaitWithinTestBudget(
    Promise.race([waiting.promise, pair.then(() => waiting.promise)]),
    "the stale-base backoff",
  )
  const teardown = disposePair()
  try {
    await awaitWithinTestBudget(teardown, "pair teardown with a pending stale-base backoff")
    expect(server.appends.map(({ ok }) => ok)).toEqual([true, false, true])
  } finally {
    // Release the injected wait even if teardown regresses, so the regression can fail cleanly.
    b.clock.advance(8_000)
    await teardown
  }
})
