import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isValidHint, PendingNudges, validateNudges } from "./gate"

const AUDIT_HINTS = [
  "No stored memory clears the bar for this planning step; the transcript already contains the full methodology, QA approach, and rollout.",
  "This memory covers OAuth login prompts and remote-test helpers, not the goal continuation timer delay.",
]
const FACTUAL_HINTS = [
  "The fix is on senpi main, not the extension.",
  "senpi monitors have a verified two-flag desync where registry.paused can remain set.",
  "The regression test does not cover Windows process cleanup.",
  "The outage is unrelated to the database migration.",
  "The patch does not address Windows process cleanup.",
  "The timeout does not pertain to database connections.",
  "The incident report is not about the database migration.",
  "The memory regression test does not cover Windows process cleanup.",
]
const path = "reference/a.md"
const options = { candidates: new Set([path]), surfaced: new Set<string>(), maxItems: 1 }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("meta hint validation", () => {
  for (const hint of AUDIT_HINTS) {
    test(`#given a meta hint ${hint} #when revalidated #then it is rejected without spending the cap or reserving its path`, () => {
      expect(isValidHint(hint)).toBe(false)
      expect(validateNudges([{ path, hint }], options)).toEqual([])
      const corrected = { path, hint: FACTUAL_HINTS[0]! }
      expect(validateNudges([{ path, hint }, corrected], options)).toEqual([corrected])
    })

    test(`#given a pending meta hint ${hint} #when taken #then the whole payload is rejected and deleted`, async () => {
      const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-meta-")))
      tempDirs.push(dir)
      const pending = new PendingNudges(dir)
      await pending.write("session-1", [
        { path: "notes/valid.md", hint: FACTUAL_HINTS[0]! },
        { path, hint },
      ], { epoch: 0 })

      expect(await pending.take("session-1", { currentEpoch: 0 })).toEqual([])
      expect(await readdir(dir)).toEqual([])
    })
  }

  for (const hint of FACTUAL_HINTS) {
    test(`#given a factual hint ${hint} #when revalidated and taken #then it survives both layers unchanged`, async () => {
      const nudge = { path, hint }
      expect(isValidHint(hint)).toBe(true)
      expect(validateNudges([nudge], options)).toEqual([nudge])
      const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-meta-")))
      tempDirs.push(dir)
      const pending = new PendingNudges(dir)
      await pending.write("session-1", [nudge], { epoch: 0 })

      expect(await pending.take("session-1", { currentEpoch: 0 })).toEqual([nudge])
      expect(await readdir(dir)).toEqual([])
    })
  }

  test.each([
    "NO STORED MEMORY fits this task.",
    "Nothing clears the bar here.",
    "This memory is not relevant to the task.",
    "No relevant memory is available.",
    "This memory is unrelated to the task.",
    "This memory does not cover the task.",
    "This memory does not address the task.",
    "This memory does not pertain to the task.",
    "This memory is not about the task.",
    "These memories are unrelated to the task.",
    "These memories do not cover the task.",
    "These memories are not about the task.",
    "These memories cover login prompts, not the timer.",
  ])("#given decision-language meta hint %s #when revalidated #then it is rejected", (hint) => {
    expect(validateNudges([{ path, hint }], options)).toEqual([])
  })

  test.each([
    "The unrelated token is a field name in the fixture.",
    "The cover image is on main, not the extension.",
    "The relevant flag is disabled by default.",
  ])("#given factual hint %s #when revalidated #then decision-language fragments do not reject it", (hint) => {
    expect(validateNudges([{ path, hint }], options)).toEqual([{ path, hint }])
  })
})
