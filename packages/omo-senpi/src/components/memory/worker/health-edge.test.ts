import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitReflectionHealthAlert } from "./health-alert"
import { readReflectionHealth } from "./health"
import { CapturedCompletionApi } from "./runner.test-support"

const roots: string[] = []
const now = Date.parse("2030-01-01T12:00:00Z")
const launcher = { runtime: "old-runtime", execPath: "/old/omo", pid: 111, sessionId: "old-session" }
const currentLauncher = { runtime: "new-runtime", execPath: "/new/omo", pid: 222, sessionId: "new-session" }
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "health-edge-"))
  roots.push(root)
  for (let index = 0; index < 3; index++) {
    await writeFile(join(root, `run-${index}.json`), JSON.stringify({
      schemaVersion: 1, runId: `run-${index}`, identity: "agent-test", category: "quick",
      conversationIds: ["old-session"], trigger: "manual", outcome: "failed",
      reason: "child_exit", detail: "ENOENT: missing asset",
      startedAt: new Date(now - 5000 + index).toISOString(),
      finishedAt: new Date(now - 4000 + index).toISOString(),
      launcher, delivery: { status: "consumed", sessionId: "old-session" },
    }))
  }
  const api = new CapturedCompletionApi()
  const notifications: string[] = []
  const live = { sessionId: "new-session", api, ui: { notify: (message: string) => notifications.push(message) } }
  return { root, api, notifications, live }
}

test("#given historical consumed failures #when bind observes no completion #then no health alert is emitted", async () => {
  const item = await fixture()
  const emitted = await emitReflectionHealthAlert(item.root, "agent-test", item.live, () => true,
    { observedRunIds: [], currentLauncher, now })
  expect(emitted).toBe(false)
  expect(item.api.entries).toEqual([])
  expect(item.notifications).toEqual([])
  expect((await readReflectionHealth(item.root, { now })).streak).toBe(3)
})

test("#given a consumed member of the active streak #when alerted #then launcher attribution survives into the entry", async () => {
  const item = await fixture()
  const emitted = await emitReflectionHealthAlert(item.root, "agent-test", item.live, () => true,
    { observedRunIds: ["run-2"], currentLauncher, now })
  expect(emitted).toBe(true)
  expect(item.api.entries).toHaveLength(1)
  expect(item.api.entries[0]?.data).toMatchObject({
    launcher, thisRuntime: "new-runtime", streakRuntimes: ["old-runtime"],
  })
  expect(item.notifications).toHaveLength(1)
})

test("#given an unrelated observed run #when another session has a current failure streak #then that history is not replayed", async () => {
  const item = await fixture()
  const emitted = await emitReflectionHealthAlert(item.root, "agent-test", item.live, () => true,
    { observedRunIds: ["already-recovered-run"], currentLauncher, now })
  expect(emitted).toBe(false)
  expect(item.api.entries).toEqual([])
})

test("#given recorded launcher identity #when health is derived #then failure metadata remains attributable", async () => {
  const item = await fixture()
  const health = await readReflectionHealth(item.root, { now, includeStreakRunIds: true })
  expect(health.lastFailure).toMatchObject({ launcher })
  expect(health).toMatchObject({ streakRuntimes: ["old-runtime"], streakRunIds: ["run-2", "run-1", "run-0"] })
})
