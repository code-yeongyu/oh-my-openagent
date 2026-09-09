import { afterEach, describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { CANDIDATE_PATH, callNudge, fixture, launchInput, nudgeOnce, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

const SECRET = "sk-live-abcdefghijklmnop"
const SECRET_ERROR = `Authorization: Bearer ${SECRET}`

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

function captureWarnings(): {
  readonly warnings: Array<{ readonly message: string; readonly details?: unknown }>
  readonly logger: { info: () => void; warn: (message: string, details?: unknown) => void; error: () => void }
} {
  const warnings: Array<{ message: string; details?: unknown }> = []
  return {
    warnings,
    logger: {
      info: () => undefined,
      warn: (message, details) => { warnings.push({ message, details }) },
      error: () => undefined,
    },
  }
}

describe("KibitzerGateRunner", () => {
  test("#given a silent normal judge #when the runner launches #then the result is empty", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => undefined)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("empty")
  })

  test("#given a rejected-only nudge then a normal stop #when the runner launches #then the result is empty", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async (options) => {
      const rejected = await callNudge(options, "notes/never-offered.md", "Drain nodes before a rollout.")
      if (!rejected.isError) throw new Error("expected the fabricated path to be rejected")
    })
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("empty")
  })

  test("#given a child turn that ends with a secret-bearing provider error #when the runner launches #then child_failed is redacted and logs omit the token", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const failing = scriptedSession(async () => {
      throw new Error(SECRET_ERROR)
    })
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: failing.createSession,
      logger,
    }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "child_failed", reason: "redacted" })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
    const failureLog = warnings.find((entry) => entry.message === "kibitzer gate child failed")
    expect(failureLog).toBeDefined()
    expect(failureLog?.details).toMatchObject({ runId: result.runId, cause: "child_failed", reason: "redacted" })
    expect(JSON.stringify({ result, warnings })).not.toContain(SECRET)
  })

  test("#given loadConfig throws #when the runner launches #then the failure is launch_failed with a normalized reason", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      loadConfig: () => {
        throw new Error("config\t missing")
      },
      logger,
    }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "launch_failed", reason: "config missing" })
    expect(warnings).toContainEqual({
      message: "kibitzer gate launch failed",
      details: { error: "config missing" },
    })
  })

  test("#given session creation throws a secret-bearing error #when the runner launches #then the creation warning is sanitized", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: async () => {
        throw new Error(`boot failed ${SECRET_ERROR}`)
      },
      logger,
    }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "session_create_failed", reason: "redacted" })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
    const creationLog = warnings.find((entry) => entry.message === "kibitzer gate child session creation failed")
    expect(creationLog).toBeDefined()
    expect(creationLog?.details).toMatchObject({ error: "redacted" })
    expect(JSON.stringify({ result, warnings })).not.toContain(SECRET)
  })

  test("#given a child that accepts one nudge then never settles #when the launch deadline fires #then the result is nudged with partial true and the accepted path", async () => {
    // given: the judge records one valid nudge, then the child turn stays open until the deadline.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const result = await runner.launch(launchInput({ deadlineMs: 50 }))

    // then
    expect(result.status).toBe("nudged")
    if (result.status === "nudged") {
      expect(result.partial).toBe(true)
      expect(result.nudges[0]?.path).toBe(CANDIDATE_PATH)
    }
  })

  test("#given a child that never nudges and never settles #when the launch deadline fires #then the result is dropped with cause deadline", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => undefined)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const result = await runner.launch(launchInput({ deadlineMs: 50 }))

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "deadline" })
    expect(result.status).not.toBe("nudged")
  })

  test("#given an accepted nudge and a compaction epoch bump mid-flight #when the launch deadline fires #then the result is dropped with cause compaction", async () => {
    // given: the child accepted a nudge against transcript T1; the live epoch no longer matches.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const result = await runner.launch(launchInput({
      deadlineMs: 50,
      compactionEpoch: 1,
      currentCompactionEpoch: () => 2,
    }))

    // then
    expect(result).toMatchObject({ status: "dropped", cause: "compaction" })
  })

  test("#given a completed scripted run #when the runner launches #then outcome.json records status completed", async () => {
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => undefined)
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))
    const pending = runner.launch(launchInput())
    stub.resolve()
    await pending
    const names = await readdir(join(identityPaths.recall, "runs"))
    expect(names).toHaveLength(1)
    const name = names[0]
    expect(name).toBeDefined()
    if (name === undefined) return
    const parsed: unknown = JSON.parse(await readFile(join(identityPaths.recall, "runs", name, "outcome.json"), "utf8"))
    expect(parsed).toMatchObject({ version: 1, status: "completed" })
  })
})
