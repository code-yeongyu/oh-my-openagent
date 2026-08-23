import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ThemeColor } from "@code-yeongyu/senpi"

import {
  emitReflectionHealthAlert,
  REFLECTION_HEALTH_ENTRY_TYPE,
  renderReflectionHealthEntry,
  type ReflectionHealthEntry,
} from "./health-alert"
import { CapturedCompletionApi } from "./runner.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("reflection health alert", () => {
  test("#given three stable failures and a live UI #when health alerting repeats in one session #then one entry and one warning are emitted", async () => {
    // given
    const root = await failureStreak(3, "stable")
    const harness = liveHarness()

    // when
    await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)
    await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)

    // then
    expect(harness.api.entries.filter((entry) => entry.customType === REFLECTION_HEALTH_ENTRY_TYPE)).toHaveLength(1)
    expect(harness.notifications).toHaveLength(1)
  })

  test("#given the alert entry is appended #when the transcript is inspected #then it carries the streak fingerprint and remediation", async () => {
    // given
    const root = await failureStreak(3, "stable")
    const harness = liveHarness()

    // when
    const emitted = await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)

    // then
    expect(emitted).toBe(true)
    const entry = harness.api.entries.find((item) => item.customType === REFLECTION_HEALTH_ENTRY_TYPE)?.data as Record<string, unknown>
    expect(entry).toMatchObject({
      schemaVersion: 1,
      identity: "agent-test",
      streak: 3,
      fingerprint: "child_exit:stable",
      lastReason: "child_exit",
      lastDetail: "stable",
    })
    expect(typeof entry.recommendation).toBe("string")
  })

  test("#given only two consecutive failures #when alerting runs #then the streak threshold suppresses the alert", async () => {
    // given
    const root = await failureStreak(2, "stable")
    const harness = liveHarness()

    // when
    const emitted = await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)

    // then
    expect(emitted).toBe(false)
    expect(harness.api.entries).toHaveLength(0)
    expect(harness.notifications).toEqual([])
  })

  test("#given a long streak whose recent failures each differ #when alerting runs #then the unstable fingerprint suppresses the alert", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-alert-"))
    roots.push(root)
    for (let index = 0; index < 3; index += 1) {
      await writeFile(
        join(root, `run-${index}.json`),
        JSON.stringify(completion(`run-${index}`, minutesAgo(60 - index * 10), `detail-${index}`)),
      )
    }
    const harness = liveHarness()

    // when
    const emitted = await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)

    // then
    expect(emitted).toBe(false)
    expect(harness.api.entries).toHaveLength(0)
  })

  test("#given a stable streak a week stale #when alerting runs #then recency suppresses the alert", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-alert-"))
    roots.push(root)
    for (let index = 0; index < 3; index += 1) {
      await writeFile(
        join(root, `run-${index}.json`),
        JSON.stringify(completion(`run-${index}`, daysAgo(10 - index), "stable")),
      )
    }
    const harness = liveHarness()

    // when
    const emitted = await emitReflectionHealthAlert(root, "agent-test", harness.live, harness.once)

    // then
    expect(emitted).toBe(false)
    expect(harness.api.entries).toHaveLength(0)
    expect(harness.notifications).toEqual([])
  })

  test("#given a session without a UI #when alerting runs #then nothing is appended", async () => {
    // given
    const root = await failureStreak(3, "stable")
    const api = new CapturedCompletionApi()

    // when
    const emitted = await emitReflectionHealthAlert(root, "agent-test", { sessionId: "session-a", api }, () => true)

    // then
    expect(emitted).toBe(false)
    expect(api.entries).toHaveLength(0)
  })

  test("#given the same fingerprint in a second session #when alerting runs #then the guard key admits the new session", async () => {
    // given
    const root = await failureStreak(3, "stable")
    const seen = new Set<string>()
    const once = (key: string): boolean => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }
    const first = liveHarness("session-a")
    const second = liveHarness("session-b")

    // when
    await emitReflectionHealthAlert(root, "agent-test", first.live, once)
    await emitReflectionHealthAlert(root, "agent-test", second.live, once)

    // then
    expect([...seen]).toEqual(["session-a:child_exit:stable", "session-b:child_exit:stable"])
    expect(second.api.entries.filter((entry) => entry.customType === REFLECTION_HEALTH_ENTRY_TYPE)).toHaveLength(1)
  })
})

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

const HEALTH: ReflectionHealthEntry = {
  schemaVersion: 1,
  identity: "project-a1b2c3d4",
  streak: 4,
  fingerprint: "child_exit:merge refused",
  lastReason: "child_exit",
  lastDetail: "merge refused",
  sinceISO: "2026-08-12T22:15:00.000Z",
  recommendation: "run /login <provider>",
}

describe("renderReflectionHealthEntry house notice contract", () => {
  test("#given a fragment recommendation #when it renders collapsed #then the why line is a dimmable full sentence and detail is omitted", () => {
    // when
    const component = renderReflectionHealthEntry({ data: HEALTH } as never, { expanded: false }, PLAIN_THEME as never)

    // then
    expect(component).toBeDefined()
    expect(component!.render(120).slice(1, -1).map((line) => line.slice(1).trimEnd())).toEqual([
      bold("✗ Memory reflection failing · 4 runs in a row"),
      "Run /login <provider>.",
    ])
  })

  test("#when it renders expanded #then the detail row carries reason since and identity", () => {
    // when
    const component = renderReflectionHealthEntry({ data: HEALTH } as never, { expanded: true }, PLAIN_THEME as never)

    // then
    expect(component!.render(120)[3]?.slice(1).trimEnd()).toBe(
      "reason child_exit · merge refused · since 2026-08-12T22:15:00.000Z · identity project-a1b2c3d4",
    )
  })
})

function liveHarness(sessionId = "session-a") {
  const api = new CapturedCompletionApi()
  const notifications: string[] = []
  const seen = new Set<string>()
  return {
    api,
    notifications,
    live: {
      sessionId,
      api,
      ui: { notify: (message: string) => notifications.push(message) },
    },
    once: (key: string): boolean => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
  }
}

async function failureStreak(count: number, detail: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reflection-health-alert-"))
  roots.push(root)
  for (let index = 0; index < count; index += 1) {
    await writeFile(
      join(root, `run-${index}.json`),
      JSON.stringify(completion(`run-${index}`, minutesAgo(60 - index * 10), detail)),
    )
  }
  return root
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()
}

function completion(runId: string, finishedAt: string, detail: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["past-session"],
    trigger: "manual",
    outcome: "failed",
    reason: "child_exit",
    detail,
    startedAt: finishedAt,
    finishedAt,
    delivery: { status: "consumed" },
  }
}
