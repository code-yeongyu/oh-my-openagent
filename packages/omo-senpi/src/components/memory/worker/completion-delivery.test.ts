import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { REFLECTION_COMPLETION_ENTRY_TYPE, type ReflectionCompletionRecord } from "./completion-contracts"
import { deliverReflectionCompletion } from "./completion-delivery"
import {
  consumePendingReflectionCompletions,
  recordReflectionCompletion,
  renderReflectionCompletionEntry,
} from "./completion"
import { recapFixture } from "./reflection-recap.test-support"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () =>
  Promise.all(
    roots
      .splice(0)
      .map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  ),
)

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
  test("renders one redacted notice for an offline drop beyond the drain limit and none for empty runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "reflection-drop-delivery-"))
    roots.push(root)
    const empty = failedRecord({ outcome: "no_changes" })
    const dropped = failedRecord({
      outcome: "no_changes",
      runId: "older-dropped",
      finishedAt: empty.startedAt,
      droppedCount: 2,
      dropReason: "frontmatter",
      detail: "error: raw provider/model text; private-path.md",
    })
    await recordReflectionCompletion(root, dropped)
    for (const index of [1, 2, 3, 4, 5, 6]) {
      await recordReflectionCompletion(root, { ...empty, runId: `empty-${index}` })
    }

    const entries: unknown[] = []
    const live = {
      sessionId: "next-session",
      api: {
        appendEntry(type: string, data: unknown) {
          if (type === REFLECTION_COMPLETION_ENTRY_TYPE) entries.push(data)
        },
        registerEntryRenderer() {},
      },
    }
    const now = Date.parse(empty.finishedAt)
    await consumePendingReflectionCompletions(root, empty.identity, live, now)
    await consumePendingReflectionCompletions(root, empty.identity, live, now)

    const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text }
    const notices = entries.flatMap((data) => {
      const component = renderReflectionCompletionEntry({ data } as never, { expanded: true }, theme as never)
      return component === undefined ? [] : [component.render(120).join("\n")]
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("Reflection dropped 2 memory entries")
    expect(notices[0]).toContain("invalid frontmatter")
    expect(notices[0]).not.toMatch(/raw provider|private-path/)
  })

  test("#given a proven merge #when delivered #then only the transcript is enriched", async () => {
    const root = await mkdtemp(join(tmpdir(), "recap-delivery-"))
    roots.push(root)
    const fixture = await recapFixture(root)
    const entries: unknown[] = []
    const live = {
      sessionId: "recipient",
      identityContext: fixture.context,
      api: {
        appendEntry: (_type: string, data?: unknown) => {
          entries.push(data)
        },
        registerEntryRenderer() {},
      },
    }
    const delivered = await deliverReflectionCompletion(fixture.completionsDir, fixture.record, live)
    expect(entries).toEqual([
      {
        ...delivered,
        recap: expect.objectContaining({
          schemaVersion: 1,
          runId: fixture.record.runId,
          deliverySessionId: "recipient",
          conversationIds: ["conversation-a", "conversation-b"],
          report: {
            status: "available",
            text: fixture.report,
            preview: "# RECAP_SENTINEL\n한국어 기록\n- Saved synthetic preference",
            sourceTruncated: false,
          },
        }),
      },
    ])
    expect(JSON.parse(await readFile(join(fixture.completionsDir, `${fixture.record.runId}.json`), "utf8"))).toEqual(
      delivered,
    )
    expect(delivered).not.toHaveProperty("recap")
  })

  test.each(["no_changes", "failed", "timed_out", "merge_conflict"] as const)(
    "#given %s #when delivered #then no recap is appended",
    async (outcome) => {
      const { entries } = await deliverLive(failedRecord({ outcome }))
      expect(entries[0]?.data).not.toHaveProperty("recap")
    },
  )
  test.each([
    "merged",
    "no_changes",
    "failed",
    "timed_out",
    "merge_conflict",
    "parent_dirty",
    "dirty_uncommitted",
  ] as const)(
    "#given a %s record #when delivered live #then it is journaled with its facts and no toast fires",
    async (outcome) => {
      // given
      const detail = "spawn ENOENT: senpi binary not found"
      const record = failedRecord({ outcome, reason: "spawn_failed", detail })

      // when
      const { delivered, entries, notifications } = await deliverLive(record)

      // then
      expect(notifications).toEqual([])
      expect(delivered).toMatchObject({ outcome, reason: "spawn_failed", detail, delivery: { status: "consumed" } })
      expect(entries).toEqual([{ customType: REFLECTION_COMPLETION_ENTRY_TYPE, data: delivered }])
    },
  )
})
