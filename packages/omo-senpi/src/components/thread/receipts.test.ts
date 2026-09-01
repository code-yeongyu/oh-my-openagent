import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  RECEIPT_RETENTION_MS,
  createReceiptStore,
  deriveEffectiveKey,
  type ReceiptInput,
} from "./receipts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "omo-thread-receipts-"))
  roots.push(value)
  return value
}

function input(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    caller_session_id: "caller-1",
    tool: "thread_send",
    idempotency_key: "send-1",
    args: { thread: "target-1", message: "hello", delivery: "auto" },
    ...overrides,
  }
}

describe("durable thread receipts", () => {
  test("derives an explicit key and a stable fallback key", () => {
    expect(deriveEffectiveKey(input())).toBe("send-1")
    expect(deriveEffectiveKey(input({ idempotency_key: undefined, tool_call_id: "call-7" }))).toBe("caller-1:call-7")
  })

  test("persists prepared before side effect and replays one committed result", async () => {
    const store = createReceiptStore({ directory: root() })
    const first = store.begin(input())
    expect(first.kind).toBe("accepted")
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.status).toBe("prepared")

    store.complete(first, { thread_id: "target-1", message_seq: 1 })
    const replay = store.begin(input())
    expect(replay).toEqual({
      kind: "replay",
      deduplicated: true,
      result: { thread_id: "target-1", message_seq: 1 },
    })
  })

  test("reports conflicts and in-progress duplicates", () => {
    const store = createReceiptStore({ directory: root() })
    const first = store.begin(input())
    expect(store.begin(input())).toEqual({ kind: "in_progress", code: "idempotency_in_progress" })
    expect(store.begin(input({ args: { thread: "target-1", message: "different" } }))).toEqual({
      kind: "conflict",
      code: "idempotency_conflict",
    })
    store.complete(first, { accepted: true })
  })

  test("turns a prepared receipt into uncertain after a restart and never retries", () => {
    const directory = root()
    const first = createReceiptStore({ directory })
    const admission = first.begin(input())
    expect(admission.kind).toBe("accepted")
    const restarted = createReceiptStore({ directory })
    expect(restarted.begin(input())).toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
    expect(restarted.begin(input())).toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
  })

  test("execute leaves a prepared receipt when the crash hook fires after native accept", async () => {
    const directory = root()
    const store = createReceiptStore({ directory, crash_after_accept: true })
    let deliveries = 0
    await expect(store.execute(input(), async () => {
      deliveries++
      return { delivered: true }
    })).rejects.toThrow("receipt crash injection")
    expect(deliveries).toBe(1)
    expect(existsSync(join(directory, "receipts"))).toBe(true)
    const restarted = createReceiptStore({ directory })
    expect(restarted.begin(input())).toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
    expect(deliveries).toBe(1)
  })

  test("degrades to uncertain when the side effect throws and never retries it", async () => {
    const directory = root()
    const store = createReceiptStore({ directory })
    let deliveries = 0
    await expect(store.execute(input(), async () => {
      deliveries++
      throw new Error("transport exploded mid-delivery")
    })).rejects.toThrow("transport exploded mid-delivery")
    expect(deliveries).toBe(1)

    // The SAME store instance must not report in_progress: that state is unreachable
    // forever (no owner will ever complete it) and it hides a may-have-landed effect.
    expect(store.begin(input())).toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
    expect(store.execute(input(), async () => {
      deliveries++
      return { delivered: true }
    })).resolves.toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
    expect(deliveries).toBe(1)
  })

  test("records the failing side effect note on the durable uncertain receipt", async () => {
    const directory = root()
    const store = createReceiptStore({ directory })
    await expect(store.execute(input(), async () => {
      throw new Error("transport exploded mid-delivery")
    })).rejects.toThrow("transport exploded mid-delivery")

    const receiptsDir = join(directory, "receipts")
    const files = readdirSync(receiptsDir).filter((entry) => entry.endsWith(".json"))
    expect(files).toHaveLength(1)
    const persisted = JSON.parse(readFileSync(join(receiptsDir, files[0] as string), "utf8")) as Record<string, unknown>
    expect(persisted.status).toBe("uncertain")
    expect(persisted.error_note).toContain("transport exploded mid-delivery")

    // A restart sees the same durable verdict, and list() surfaces it unchanged.
    const restarted = createReceiptStore({ directory })
    expect(restarted.begin(input())).toEqual({ kind: "uncertain", code: "idempotency_uncertain" })
    expect(restarted.list()[0]?.status).toBe("uncertain")
  })

  test("retains receipts for thirty days and expires older records", () => {
    expect(RECEIPT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
    let now = 10_000
    const directory = root()
    const store = createReceiptStore({ directory, now: () => now })
    const admission = store.begin(input())
    store.complete(admission, { ok: true })
    now += RECEIPT_RETENTION_MS + 1
    expect(store.begin(input())).toMatchObject({ kind: "accepted" })
  })
})
