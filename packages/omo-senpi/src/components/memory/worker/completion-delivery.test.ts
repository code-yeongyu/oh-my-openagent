import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  type ReflectionCompletionRecord,
} from "./completion-contracts"
import { deliverReflectionCompletion } from "./completion-delivery"
import { recapFixture } from "./reflection-recap.test-support"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

function failedRecord(overrides: Partial<ReflectionCompletionRecord> = {}): ReflectionCompletionRecord {
  return {
    schemaVersion: 1,
    runId: "reflection-run-7",
    identity: "agent-test",
    category: "quick",
    conversationIds: ["conversation-a"],
    trigger: "dream",
    origin: "shutdown",
    outcome: "failed",
    startedAt: "2026-09-09T12:00:00.000Z",
    finishedAt: "2026-09-09T12:00:01.000Z",
    delivery: { status: "pending" },
    ...overrides,
  }
}

async function deliverLive(record: ReflectionCompletionRecord) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-delivery-")))
  roots.push(root)
  const entries: Array<{ customType: string; data: unknown }> = []
  const notifications: Array<{ message: string; level: string }> = []
  const delivered = await deliverReflectionCompletion(root, record, {
    sessionId: "conversation-a",
    api: {
      appendEntry(customType, data) {
        entries.push({ customType, data })
      },
      registerEntryRenderer() {},
    },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  })
  return { delivered, entries, notifications }
}

describe("deliverReflectionCompletion", () => {
  test("#given a proven merge #when delivered #then only the transcript is enriched", async () => {
    const root = await mkdtemp(join(tmpdir(), "recap-delivery-"))
    roots.push(root)
    const fixture = await recapFixture(root)
    const entries: unknown[] = []
    const live = {
      sessionId: "recipient", identityContext: fixture.context,
      api: { appendEntry: (_type: string, data?: unknown) => { entries.push(data) }, registerEntryRenderer() {} },
    }
    const delivered = await deliverReflectionCompletion(fixture.completionsDir, fixture.record, live)
    expect(entries).toEqual([{ ...delivered, recap: expect.objectContaining({
      schemaVersion: 1, runId: fixture.record.runId, deliverySessionId: "recipient",
      conversationIds: ["conversation-a", "conversation-b"],
      report: { status: "available", text: fixture.report, preview: "# RECAP_SENTINEL\n한국어 기록\n- Saved synthetic preference", sourceTruncated: false },
    }) }])
    expect(JSON.parse(await readFile(join(fixture.completionsDir, `${fixture.record.runId}.json`), "utf8"))).toEqual(delivered)
    expect(delivered).not.toHaveProperty("recap")
  })

  test.each(["no_changes", "failed", "timed_out", "merge_conflict"] as const)("#given %s #when delivered #then no recap is appended", async (outcome) => {
    const { entries } = await deliverLive(failedRecord({ outcome }))
    expect(entries[0]?.data).not.toHaveProperty("recap")
  })
  test("#given a failed record with reason spawn_failed and detail #when delivered live #then the notification includes both", async () => {
    // given
    const detail = "spawn ENOENT: senpi binary not found"
    const record = failedRecord({ reason: "spawn_failed", detail })

    // when
    const { delivered, entries, notifications } = await deliverLive(record)

    // then
    expect(notifications).toEqual([{
      message: "Memory reflection reflection-run-7 failed (spawn_failed): spawn ENOENT: senpi binary not found; its transcript cursor was not advanced.",
      level: "warning",
    }])
    expect(delivered.reason).toBe("spawn_failed")
    expect(delivered.detail).toBe(detail)
    expect(entries).toEqual([{ customType: REFLECTION_COMPLETION_ENTRY_TYPE, data: delivered }])
  })

  test("#given a failed record with a long detail #when delivered live #then the notification bounds detail the same way the transcript does", async () => {
    // given
    const detail = `spawn ENOENT: ${"x".repeat(200)}`

    // when
    const { notifications } = await deliverLive(failedRecord({ reason: "spawn_failed", detail }))
    const message = notifications[0]?.message ?? ""

    // then
    expect(message.startsWith("Memory reflection reflection-run-7 failed (spawn_failed): spawn ENOENT:")).toBe(true)
    expect(message.endsWith("; its transcript cursor was not advanced.")).toBe(true)
    expect(message).toContain("...")
    expect(message).not.toContain("x".repeat(200))
  })

  test("#given a failed record with neither reason nor detail #when delivered live #then the generic wording is unchanged", async () => {
    // given / when
    const { notifications } = await deliverLive(failedRecord())

    // then
    expect(notifications).toEqual([{
      message: "Memory reflection reflection-run-7 ended with failed; its transcript cursor was not advanced.",
      level: "warning",
    }])
  })
})
