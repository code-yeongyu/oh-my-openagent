import { afterEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { callNudge, CANDIDATE_PATH, fixture, launchInput, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test.each([
  "No stored memory clears the bar for this planning step; the transcript already contains the full methodology, QA approach, and rollout.",
  "This memory covers OAuth login prompts and remote-test helpers, not the goal continuation timer delay.",
])("#given a judge that only offers meta hint %s #when the runner finishes #then the result is silence", async (hint) => {
  const { identityPaths } = await fixture()
  const stub = scriptedSession(async (options) => {
    await callNudge(options, CANDIDATE_PATH, hint)
  })
  const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

  const pending = runner.launch(launchInput())
  stub.resolve()
  expect(await pending).toMatchObject({ status: "empty" })
})
