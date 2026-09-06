import { afterEach, describe, expect, test } from "bun:test"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import { MemorianGateRunner } from "./memorian-runner"
import { callNudge, fixture, launchInput, roots, runnerOptions, scriptedSession, SESSION_ID } from "./memorian-runner.test-support"
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

describe("MemorianGateRunner", () => {
  test("#given a silent normal judge #when the runner launches #then the result is empty and no pending payload is written", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async () => undefined)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("empty")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a rejected-only nudge then a normal stop #when the runner launches #then the result is empty and no pending payload is written", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(async (options) => {
      const rejected = await callNudge(options, "notes/never-offered.md", "Drain nodes before a rollout.")
      if (!rejected.isError) throw new Error("expected the fabricated path to be rejected")
    })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput())
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("empty")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a child turn that ends with a secret-bearing provider error #when the runner launches #then child_failed is redacted and logs omit the token", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const failing = scriptedSession(async () => {
      throw new Error(SECRET_ERROR)
    })
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: failing.createSession,
      logger,
    }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result).toMatchObject({ status: "failed", cause: "child_failed", reason: "redacted" })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
    const failureLog = warnings.find((entry) => entry.message === "memorian gate child failed")
    expect(failureLog).toBeDefined()
    expect(failureLog?.details).toMatchObject({ runId: result.runId, cause: "child_failed", reason: "redacted" })
    expect(JSON.stringify({ result, warnings })).not.toContain(SECRET)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given loadConfig throws #when the runner launches #then the failure is launch_failed with a normalized reason", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
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
      message: "memorian gate launch failed",
      details: { error: "config missing" },
    })
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given session creation throws a secret-bearing error #when the runner launches #then the creation warning is sanitized", async () => {
    // given
    const { identityPaths } = await fixture()
    const { warnings, logger } = captureWarnings()
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
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
    const creationLog = warnings.find((entry) => entry.message === "memorian gate child session creation failed")
    expect(creationLog).toBeDefined()
    expect(creationLog?.details).toMatchObject({ error: "redacted" })
    expect(JSON.stringify({ result, warnings })).not.toContain(SECRET)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })
})
