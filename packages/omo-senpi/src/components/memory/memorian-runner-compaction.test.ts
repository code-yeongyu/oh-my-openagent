import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdir, readFile } from "node:fs"
import { join } from "node:path"
import type { CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"
import type { CreateChildSession } from "@oh-my-opencode/senpi-task"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"
import { MemorianGateRunner } from "./memorian-runner"
import { CANDIDATE_PATH, fixture, launchInput, nudgeOnce, registrySnapshot, roots, runnerOptions, scriptedSession, SESSION_ID } from "./memorian-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("MemorianGateRunner", () => {
  test("#given a compaction accepted mid-flight #when the child finishes #then the stale nudges are discarded instead of written", async () => {
    // given: the child judged transcript T1; a compaction accepted while it ran rewrote that
    // transcript, so its verdict now advises a conversation that no longer exists.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    let epoch = 7
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when: the epoch advances while the child runs
    const pending = runner.launch(launchInput({
      compactionEpoch: epoch,
      currentCompactionEpoch: () => {
        epoch = 8
        return epoch
      },
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("dropped")
    expect(warnings).toEqual(["memorian gate nudges dropped after compaction"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a launch epoch #when the nudges are written #then the payload carries that epoch", async () => {
    // given: the epoch travels IN the payload, so the consumer - not the writer - decides staleness
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const seen: number[] = []
    const real = new PendingNudges(identityPaths.recallPending)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          seen.push(options.epoch)
          await real.write(sessionId, nudges, options)
        },
        delete: (sessionId) => real.delete(sessionId),
      },
    }))

    // when
    const pending = runner.launch(launchInput({ compactionEpoch: 9, currentCompactionEpoch: () => 9 }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("nudged")
    expect(seen).toEqual([9])
  })

  test("#given a compaction accepted DURING the pending write #when the write completes #then the landed file is retracted", async () => {
    // given: the pre-write epoch check passes, then write() awaits fs work. A compaction accepted in
    // that window bumps the epoch and its own pending-drop finds no file yet - so the rename lands a
    // pre-compaction nudge that nothing would ever remove. The runner must re-check AFTER the write.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    const real = new PendingNudges(identityPaths.recallPending)
    let epoch = 4
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          // The compaction lands while the write is still in flight: the epoch bumps here, and the
          // compaction's own pending-drop runs before this rename ever creates the file.
          epoch = 5
          await real.write(sessionId, nudges, options)
        },
        delete: (sessionId) => real.delete(sessionId),
      },
    }))

    // when
    const pending = runner.launch(launchInput({
      compactionEpoch: 4,
      currentCompactionEpoch: () => epoch,
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("dropped")
    expect(warnings).toEqual(["memorian gate nudges dropped after compaction"])
    expect(existsSync(join(identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
    expect(await real.take(SESSION_ID, { currentEpoch: epoch })).toEqual([])
  })

  test("#given a compaction that lands mid-write and no post-write retraction #when the next turn takes #then the stale payload is never consumed", async () => {
    // given: the reviewer's exact interleaving. The pre-write check passes, write() yields, the
    // compaction bumps the epoch inside that yield and its own pending-drop finds no file, then the
    // rename lands. This store deliberately performs NO retraction at all, so only the consumption
    // point can reject the payload - which is what makes correctness independent of the race.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const real = new PendingNudges(identityPaths.recallPending)
    let epoch = 4
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          // Yield mid-write, exactly where rename has not happened yet.
          await Promise.resolve()
          epoch = 5
          await real.write(sessionId, nudges, options)
        },
        // The best-effort retraction is disabled: the epoch check at take() must stand alone.
        delete: async () => undefined,
      },
    }))

    // when
    const pending = runner.launch(launchInput({ compactionEpoch: 4, currentCompactionEpoch: () => epoch }))
    stub.resolve()
    await pending

    // then: the next turn reads the live (bumped) epoch and the pre-compaction verdict never lands
    expect(await real.take(SESSION_ID, { currentEpoch: epoch })).toEqual([])
    expect(existsSync(join(identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
  })

  test("#given an unchanged compaction epoch #when the child finishes #then the nudges are written as usual", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput({
      compactionEpoch: 3,
      currentCompactionEpoch: () => 3,
    }))
    stub.resolve()
    const result = await pending

    // then: the payload carries the launch epoch, so the next turn at epoch 3 consumes it
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 3 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  })

})
