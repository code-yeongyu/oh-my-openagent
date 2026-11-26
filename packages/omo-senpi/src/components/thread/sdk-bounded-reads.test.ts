import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES } from "./contracts"
import type { ThreadTranscriptEntry } from "./reader"
import { provenanceOf } from "./refusal-texts"
import { createThreadCore } from "./sdk-core"
import { senpiContext, sessionEntries, type FakeEntryLog } from "./thread-remote-entries-fixture"
import { ENGINE, createRemoteThreadFixture } from "./thread-remote-fixture"

// D6 of omo#14943 T1b: no thread read returns an unbounded payload, and the budget is the read's own. Each read on a holder
// with more than its budget answers at most that budget, the newest entries kept, and says it was cut; a budget over the
// cap is refused with the registry's typed refusal.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// 200 messages of ~1 KiB: about 200 KiB, more than the 128 KiB default budget.
const BIG: readonly ThreadTranscriptEntry[] = Array.from({ length: 200 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `message ${index} ${"x".repeat(1000)}`,
}))
const OVER_CAP = THREAD_READ_MAX_BYTES + 1

const bytes = (entries: readonly unknown[]): number =>
  entries.reduce<number>((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry), "utf8"), 0)

function holders(entries?: FakeEntryLog) {
  const engine = { ...ENGINE, messages: entries === undefined ? BIG : senpiContext(entries.entries, null) }
  const a = account({ engine, ...(entries === undefined ? {} : { entries }) })
  const s = surface(a.remote, { engine })
  const ports = { host: s.host, store: s.store, remote: a.remote }
  const root = assembleOmoSdk({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ports }, {})
  const core = createThreadCore({ agentDir: s.agentDir, cwd: process.cwd(), uid: 501, user: "qa", ...ports } as never)
  return { root, core, s, a }
}

type Messages = {
  readonly kind: string
  readonly messages: readonly ThreadTranscriptEntry[]
  readonly truncated: boolean
  readonly total_items: number
  readonly max_bytes: number
}
type Page = { readonly kind: string; readonly items: readonly unknown[]; readonly truncated: boolean; next_cursor?: string }
type Refused = { readonly kind: "error"; readonly error: { readonly code: string } }

function overCap(answer: unknown): void {
  const { error } = answer as Refused
  expect((answer as Refused).kind).toBe("error")
  expect(error.code).toBe("message_too_large")
  expect(provenanceOf(error)?.id).toBe("read.max_bytes_over_cap")
}

describe("threads.messages", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given %s holding more than the default budget #when the root asks for its messages #then the newest that fit 128 KiB, truncated, with the whole count",
    async (thread) => {
      const { root } = holders()
      const answer = (await root.threads.messages({ thread })) as unknown as Messages
      expect(answer.kind).toBe("ok")
      expect(answer.max_bytes).toBe(THREAD_READ_DEFAULT_BYTES)
      expect(bytes(answer.messages)).toBeLessThanOrEqual(THREAD_READ_DEFAULT_BYTES)
      expect(answer.truncated).toBe(true)
      expect(answer.total_items).toBe(BIG.length)
      expect(answer.messages).toEqual(BIG.slice(BIG.length - answer.messages.length))
    },
  )

  test("#given a budget of its own #when the core reads the messages #then at most that budget, newest kept", async () => {
    const { core } = holders()
    const answer = (await core.messages({ thread: "dur-local", max_bytes: 4096 } as never)) as unknown as Messages
    expect(bytes(answer.messages)).toBeLessThanOrEqual(4096)
    expect(answer.messages.at(-1)).toEqual(BIG.at(-1))
    expect(answer).toMatchObject({ truncated: true, total_items: BIG.length, max_bytes: 4096 })
  })

  test("#given a budget over the cap #when the core reads the messages #then read.max_bytes_over_cap, before the holder is asked", async () => {
    const { core, s } = holders()
    const asked = spyOn(s.host, "getMessages")
    overCap(await core.messages({ thread: "dur-local", max_bytes: OVER_CAP } as never))
    expect(asked).not.toHaveBeenCalled()
  })
})

describe("threads.read and threads.readAfterWait", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given %s holding more than the budget #when the root reads with max_bytes #then a truncated page ending at the newest message, with a cursor",
    async (thread) => {
      const { root } = holders()
      const page = (await root.threads.read({ thread, max_bytes: 4096 })) as unknown as Page
      expect(page).toMatchObject({ kind: "ok", truncated: true })
      expect(page.next_cursor).toBeString()
      expect(page.items.length).toBeLessThan(BIG.length)
      expect(JSON.stringify(page.items.at(-1))).toContain("message 199 ")
    },
  )

  test("#given a wait and a budget #when the core reads after the wait #then the same bounded, truncated page", async () => {
    const { core } = holders()
    const page = (await core.readAfterWait({ thread: "dur-local", wait_ms: 1, max_bytes: 4096 })) as unknown as Page
    expect(page).toMatchObject({ kind: "ok", truncated: true })
    expect(JSON.stringify(page.items.at(-1))).toContain("message 199 ")
  })

  test.each(["read", "readAfterWait"] as const)(
    "#given a budget over the cap #when the core runs %s #then read.max_bytes_over_cap",
    async (call) => {
      const { core } = holders()
      const request = { thread: "dur-local", max_bytes: OVER_CAP, ...(call === "readAfterWait" ? { wait_ms: 1 } : {}) }
      overCap(await core[call](request as never))
    },
  )

  test("#given a budget over the cap #when the root reads #then its input boundary refuses it (the schema's maximum is the cap)", async () => {
    const { root } = holders()
    expect(await root.threads.read({ thread: "dur-local", max_bytes: OVER_CAP })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
  })

  test("#given device b pages its entries #when the core reads with a budget over the cap #then the paged leg refuses it too", async () => {
    const log: FakeEntryLog = { entries: sessionEntries(BIG), pages: 0 }
    const { core } = holders(log)
    overCap(await core.read({ thread: "dur-on-b", max_bytes: OVER_CAP }))
    expect(log.pages).toBeGreaterThan(0)
  })
})
