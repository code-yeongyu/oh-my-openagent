import { afterEach, expect, spyOn, test } from "bun:test"
import { rm } from "node:fs/promises"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { callNudge, fixture, registrySnapshot, roots, runnerOptions, scriptedSession, SESSION_ID } from "./kibitzer-runner.test-support"
import { createKibitzerTrigger } from "./kibitzer-trigger"
import { ToolArgWindow } from "./recall-query-planner-tools"

let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined

afterEach(async () => {
  clock?.mockRestore()
  clock = undefined
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("#given A and B accepted through the trigger and C skipped for cooldown #when the window expires #then identical C creates a judge and judged C stays suppressed", async () => {
  const { identityPaths } = await fixture()
  let now = 1_800_000_000_000
  clock = spyOn(Date, "now").mockImplementation(() => now)
  const context = createMemoryIdentityContext({
    identity: "kibitzer-agent", identityPaths,
    binding: createMemoryBinding({ identity: "kibitzer-agent", repoPath: identityPaths.repo, boundAt: 0 }),
  })
  let path = "reference/a.md"
  const stub = scriptedSession(async (options) => {
    const result = await callNudge(options, path, "Use the recalled deployment policy.")
    if (result.isError) throw new Error(result.text)
  })
  stub.resolve()
  const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
  const registry = registrySnapshot()
  const accepted: string[] = []
  const reports: unknown[] = []
  const trigger = createKibitzerTrigger({
    snapshotSession: () => ({ id: SESSION_ID, entries: [] }),
    resolveModelRegistry: () => registry,
    collectCandidatesFromSnapshot: async () => ({
      sessionId: SESSION_ID, context,
      candidates: [{ path, description: "Deployment policy", excerpt: "Drain nodes first", score: 1 }],
      surfaced: new Set<string>(), maxItems: 1, transcript: [],
    }),
    runnerFor: () => runner,
    resolveContext: () => context,
    onAccepted: async (_sessionId, _context, nudges) => { accepted.push(...nudges.map((nudge) => nudge.path)) },
    report: (_sessionId, result) => { reports.push(result) },
    currentCompactionEpoch: () => 0,
    argWindow: new ToolArgWindow(),
  })

  trigger.onSettled({})
  await trigger.whenIdle()
  path = "reference/b.md"
  trigger.onSettled({})
  await trigger.whenIdle()
  expect(accepted).toEqual(["reference/a.md", "reference/b.md"])
  expect(stub.created).toBe(2)

  path = "reference/c.md"
  trigger.onSettled({})
  await trigger.whenIdle()
  expect(reports).toEqual([{ status: "skipped", cause: "cooldown", candidateCount: 1 }])
  expect(stub.created).toBe(2)

  // A cooldown attempt must not erase suppression for the last actually judged set.
  path = "reference/b.md"
  trigger.onSettled({})
  await trigger.whenIdle()
  expect(reports).toHaveLength(1)
  expect(stub.created).toBe(2)

  path = "reference/c.md"
  now += 600_000
  trigger.onSettled({})
  await trigger.whenIdle()
  expect(stub.created).toBe(3)
  expect(accepted).toEqual(["reference/a.md", "reference/b.md", "reference/c.md"])

  trigger.onSettled({})
  await trigger.whenIdle()
  expect(stub.created).toBe(3)
  expect(accepted).toHaveLength(3)
}, 20_000)
