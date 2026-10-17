import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { PanelMemoryIdentity, PanelMemorySource } from "../types"
import { createPanelMemoryReader } from "./memory"

const identity: PanelMemoryIdentity = {
  id: "notwork-09334074",
  reflectionDir: "/mem/agents/notwork-09334074/runtime/reflection",
  recallDir: "/mem/agents/notwork-09334074/runtime/recall",
  factsQueueDir: "/mem/agents/notwork-09334074/runtime/facts-queue",
  recallLedgerDir: "/mem/agents/notwork-09334074/runtime/recall/ledger",
  recallPendingDir: "/mem/agents/notwork-09334074/runtime/recall/pending",
}

const SESSION = "01a0c2b7-adb1-7e1d-8d80-da16a25469ff"
const PARKED_AT = "2026-09-21T09:00:00.000Z"
/** REFLECTION_PARK_PROBE_INTERVAL_MS is six hours. */
const SIX_HOURS_AFTER_PARK = "2026-09-21T15:00:00.000Z"

interface FakeOptions {
  readonly park?: Awaited<ReturnType<PanelMemorySource["park"]>>
  readonly dirs?: Readonly<Record<string, readonly string[]>>
  readonly files?: Readonly<Record<string, unknown>>
  readonly tails?: Readonly<Record<string, { readonly text: string; readonly truncated: boolean }>>
}

/** Counts every path touched, so "this read never happens" can be proven rather than assumed. */
function fakeSource(options: FakeOptions = {}) {
  const touched: string[] = []
  const port: PanelMemorySource = {
    async park(dir) {
      touched.push(dir)
      return options.park
    },
    async list(dir) {
      touched.push(dir)
      return options.dirs?.[dir] ?? []
    },
    async readJson(path) {
      touched.push(path)
      return options.files?.[path]
    },
    async readTail(path) {
      touched.push(path)
      return options.tails?.[path]
    },
  }
  return { port, touched }
}

const wakesFile = join(identity.recallDir, "sidecars", Buffer.from(SESSION, "utf8").toString("base64url"), "wakes.ndjson")
const ledgerFile = join(identity.recallLedgerDir, `${SESSION}.json`)
const pendingFile = join(identity.recallPendingDir, `${SESSION}.json`)
const readMemory = (source: PanelMemorySource) => createPanelMemoryReader(source, () => Date.parse(PARKED_AT))

describe("createPanelMemoryReader", () => {
  test("#given a parked identity #when read #then the column gets the park facts it draws", async () => {
    // given the scheduler parked automatic reflection after repeated deterministic failures
    const source = fakeSource({
      park: {
        version: 1,
        streak: 3,
        parkedAt: PARKED_AT,
        lastFailure: {
          runId: "run-7",
          at: PARKED_AT,
          fingerprint: "sandbox:bwrap",
          retryable: false,
          reason: "reflection sandbox refused to start",
          detail: "bwrap: Creating new namespace failed: Operation not permitted",
        },
      },
    })

    // when
    const memory = await createPanelMemoryReader(source.port)(identity, SESSION)

    // then
    expect(memory?.identity).toBe("notwork-09334074")
    expect(memory?.reflection).toEqual({
      streak: 3,
      parkedAt: PARKED_AT,
      nextProbeAt: SIX_HOURS_AFTER_PARK,
      reason: "reflection sandbox refused to start",
      detail: "bwrap: Creating new namespace failed: Operation not permitted",
    })
  })

  test("#given a half-open probe already spent #when read #then the next probe is measured from it", async () => {
    // given the host measures the interval from lastProbeAt when there is one
    // (`reflectionParkNextProbeAt`), so a probed identity must not look overdue forever
    const source = fakeSource({
      park: { version: 1, streak: 4, parkedAt: "2026-09-20T00:00:00.000Z", lastProbeAt: PARKED_AT },
    })

    // when / then
    expect((await createPanelMemoryReader(source.port)(identity, SESSION))?.reflection?.nextProbeAt).toBe(
      SIX_HOURS_AFTER_PARK,
    )
  })

  test("#given failures that have not parked yet #when read #then the streak comes through alone", async () => {
    // given a streak below the threshold is worth showing and is not a park
    const source = fakeSource({ park: { version: 1, streak: 2 } })

    // when
    const reflection = (await createPanelMemoryReader(source.port)(identity, SESSION))?.reflection

    // then
    expect(reflection?.streak).toBe(2)
    expect(reflection?.parkedAt).toBeUndefined()
    expect(reflection?.nextProbeAt).toBeUndefined()
  })

  test("#given healthy reflection #when read #then no reflection block is reported", async () => {
    // given an empty park state is what a working identity looks like, and it is not news
    const source = fakeSource({ park: { version: 1, streak: 0 } })

    // when
    const memory = await createPanelMemoryReader(source.port)(identity, SESSION)

    // then
    expect(memory?.reflection).toBeUndefined()
    expect(memory?.identity).toBe("notwork-09334074")
  })

  test("#given an unreadable park file #when read #then the rest of the block survives", async () => {
    // given a hand-edited or truncated park.json must not blank the identity and the backlog
    const source = fakeSource({
      dirs: { [identity.factsQueueDir]: ["20260921T090000000Z-abc123def456-0a1b2c3d.json"] },
    })

    // when
    const memory = await createPanelMemoryReader(source.port)(identity, SESSION)

    // then
    expect(memory?.reflection).toBeUndefined()
    expect(memory?.factsQueued).toBe(1)
  })

  test("#given a facts queue #when read #then bookkeeping files are not counted as backlog", async () => {
    // given the queue dir also holds the cursor dir and two watermark files
    const source = fakeSource({
      dirs: {
        [identity.factsQueueDir]: [
          "20260921T090000000Z-abc123def456-0a1b2c3d.json",
          "20260921T091000000Z-abc123def456-1a2b3c4d.json",
          "consumed.json",
          "failures.json",
          "claims.json",
          "cursor",
          "20260921T092000000Z-abc123def456-2a3b4c5d.json.tmp-4242",
        ],
      },
    })

    // when / then
    expect((await readMemory(source.port)(identity, SESSION))?.factsQueued).toBe(2)
  })

  test("#given a recall ledger for this session #when read #then the surfaced paths are counted", async () => {
    // given
    const source = fakeSource({
      files: {
        [ledgerFile]: {
          version: 1,
          surfaced: {
            "reference/strix-halo.md": { hash: "a", at: PARKED_AT },
            "system/human.md": { hash: "b", at: PARKED_AT },
          },
        },
      },
    })

    // when / then
    expect((await createPanelMemoryReader(source.port)(identity, SESSION))?.recallSurfaced).toBe(2)
  })

  test("#given pending nudges for this session #when read #then they are counted and left alone", async () => {
    // given `PendingNudges.take()` DELETES the file; a status column that consumed the session's
    // nudges would be a bug wearing a rendering choice
    const source = fakeSource({
      files: {
        [pendingFile]: {
          version: 1,
          sessionId: SESSION,
          writtenAt: PARKED_AT,
          nudges: [{ path: "notes/open-threads.md", hint: "check the parked thread" }],
        },
      },
    })

    // when / then
    expect((await readMemory(source.port)(identity, SESSION))?.recallPending).toBe(1)
  })

  test("#given a pending file owned by another session #when read #then it is not counted here", async () => {
    // given sanitizeSessionFilename maps distinct session ids onto one filename, which is why
    // the host verifies the embedded id before it trusts the payload
    const source = fakeSource({
      files: {
        [pendingFile]: {
          version: 1,
          sessionId: "some-other-session",
          writtenAt: PARKED_AT,
          nudges: [{ path: "notes/open-threads.md", hint: "not yours" }],
        },
      },
    })

    // when / then
    expect((await readMemory(source.port)(identity, SESSION))?.recallPending).toBe(0)
  })

  test("#given an expired pending file #when read #then stale nudges are not reported as waiting", async () => {
    // given
    const source = fakeSource({
      files: {
        [pendingFile]: {
          version: 1,
          sessionId: SESSION,
          writtenAt: "2026-09-19T09:00:00.000Z",
          nudges: [{ path: "notes/open-threads.md", hint: "stale" }],
        },
      },
    })

    // when / then
    expect((await readMemory(source.port)(identity, SESSION))?.recallPending).toBe(0)
  })

  test("#given a malformed pending payload #when read #then no partial count is exposed", async () => {
    // given
    const source = fakeSource({
      files: {
        [pendingFile]: {
          version: 1,
          sessionId: SESSION,
          writtenAt: PARKED_AT,
          nudges: [{ path: "notes/open-threads.md" }],
        },
      },
    })

    // when / then
    expect((await readMemory(source.port)(identity, SESSION))?.recallPending).toBe(0)
  })

  test("#given no session id yet #when read #then the recall files are not even looked for", async () => {
    // given recall state is per session, so without one there is nothing to name
    const source = fakeSource()

    // when
    const memory = await createPanelMemoryReader(source.port)(identity, undefined)

    // then
    expect(memory?.recallSurfaced).toBe(0)
    expect(memory?.recallPending).toBe(0)
    expect(source.touched.some((path) => path.includes("recall"))).toBe(false)
  })

  test("#given no identity #when read #then nothing is read at all", async () => {
    // given memory can be off, or the identity can fail to resolve; both mean a silent block
    const source = fakeSource()

    // when
    const memory = await createPanelMemoryReader(source.port)(undefined, SESSION)

    // then
    expect(memory).toBeUndefined()
    expect(source.touched).toEqual([])
  })
})

describe("the kibitzer's own wake log", () => {
  const wake = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      version: 1,
      at: "2026-09-21T11:00:00.000Z",
      sessionId: SESSION,
      wake: 1,
      generation: 1,
      status: "completed",
      candidateCount: 4,
      nudged: ["notes/open-threads.md"],
      steered: 0,
      toolCalls: 3,
      durationMs: 4_200,
      slotWaitMs: 12,
      usage: { input: 8_000, output: 400, cacheRead: 1_200, cacheWrite: 600 },
      diagnostic: false,
      ...overrides,
    })

  test("#given settled wakes #when read #then the count, the last wake and what it spent come through", async () => {
    // given wakes.ndjson is the kibitzer's only durable trace: one closed record per settled wake
    const source = fakeSource({
      tails: {
        [wakesFile]: {
          text: [wake(), wake({ wake: 2, at: "2026-09-21T11:40:00.000Z", nudged: ["a.md", "b.md"] })].join("\n") + "\n",
          truncated: false,
        },
      },
    })

    // when
    const kibitzer = (await createPanelMemoryReader(source.port)(identity, SESSION))?.kibitzer

    // then
    expect(kibitzer?.wakes).toBe(2)
    expect(kibitzer?.lastWakeAt).toBe("2026-09-21T11:40:00.000Z")
    expect(kibitzer?.nudged).toBe(3)
    expect(kibitzer?.tokens).toBe(20_400)
    expect(kibitzer?.lastFailed).toBe(false)
    expect(kibitzer?.partial).toBe(false)
  })

  test("#given the last wake was a diagnostic failure #when read #then it is flagged", async () => {
    // given three consecutive diagnostic failures are what raise the host's own gate notice
    const source = fakeSource({
      tails: { [wakesFile]: { text: wake({ status: "failed", diagnostic: true, reason: "model refused" }) + "\n", truncated: false } },
    })

    // when
    const kibitzer = (await createPanelMemoryReader(source.port)(identity, SESSION))?.kibitzer

    // then
    expect(kibitzer?.lastFailed).toBe(true)
    expect(kibitzer?.lastStatus).toBe("failed")
  })

  test("#given a torn line in the middle #when read #then the whole lines still count", async () => {
    // given the writer appends; a reader can always catch a half-written last line, and the host's
    // own nudge reader is fail-closed per line for exactly this reason
    const source = fakeSource({
      tails: { [wakesFile]: { text: [wake(), '{"version":1,"at":"2026', wake({ wake: 3 })].join("\n"), truncated: false } },
    })

    // when / then
    expect((await createPanelMemoryReader(source.port)(identity, SESSION))?.kibitzer?.wakes).toBe(2)
  })

  test("#given a log too large to read whole #when read #then the counts say so instead of lying", async () => {
    // given only the tail is read, so the numbers are a floor, not a total
    const source = fakeSource({ tails: { [wakesFile]: { text: wake() + "\n", truncated: true } } })

    // when / then
    expect((await createPanelMemoryReader(source.port)(identity, SESSION))?.kibitzer?.partial).toBe(true)
  })

  test("#given no sidecar log #when read #then no kibitzer block is reported", async () => {
    // given a session the kibitzer never woke for is the ordinary case
    const source = fakeSource()

    // when / then
    expect((await createPanelMemoryReader(source.port)(identity, SESSION))?.kibitzer).toBeUndefined()
  })

  test("#given no session id #when read #then the sidecar log is not even looked for", async () => {
    // given the sidecar directory is named after the parent session
    const source = fakeSource()

    // when
    await createPanelMemoryReader(source.port)(identity, undefined)

    // then
    expect(source.touched.some((path) => path.includes("sidecars"))).toBe(false)
  })
})
