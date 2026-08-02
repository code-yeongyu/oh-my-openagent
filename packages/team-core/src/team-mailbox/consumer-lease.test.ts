/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { withInboxConsumerLease } from "./consumer-lease"

function createSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolveSignal: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve
  })

  if (resolveSignal === undefined) {
    throw new Error("signal resolver was not initialized")
  }

  return { promise, resolve: resolveSignal }
}

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-consumer-lease-"))
}

describe("withInboxConsumerLease", () => {
  test("#given two callers for one inbox w2tc #when both acquire the consumer lease #then their callbacks are serialized", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const firstEntered = createSignal()
    const releaseFirst = createSignal()
    const activeCallbacks = new Set<string>()
    const overlapObserved: string[] = []

    // when
    const first = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      activeCallbacks.add("first")
      firstEntered.resolve()
      await releaseFirst.promise
      if (activeCallbacks.has("second")) overlapObserved.push("first")
      activeCallbacks.delete("first")
      return "first"
    }, { staleAfterMs: 300_000 })
    await firstEntered.promise

    const second = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      activeCallbacks.add("second")
      if (activeCallbacks.has("first")) overlapObserved.push("second")
      activeCallbacks.delete("second")
      return "second"
    }, { staleAfterMs: 300_000 })

    releaseFirst.resolve()
    const results = await Promise.all([first, second])

    // then
    expect(results).toEqual(["first", "second"])
    expect(overlapObserved).toEqual([])
  })

  test("#given a dead-pid consumer lease w2tc #when staleAfterMs is zero #then the inbox is reacquired immediately", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    const leasePath = path.join(inboxDir, ".consumer.lock")
    await mkdir(inboxDir, { recursive: true })
    await writeFile(leasePath, `dead-consumer\n999999999\n${Date.now() - 1}\n`)

    // when
    const result = await withInboxConsumerLease(
      teamRunId,
      "m1",
      config,
      async () => "reacquired",
      { staleAfterMs: 0 },
    )

    // then
    expect(result).toBe("reacquired")
    await expect(readFile(leasePath, "utf8")).rejects.toThrow()
  }, 2_000)

  test("#given a caller already owns an inbox lease w2tc #when a mailbox primitive reacquires it #then the nested transaction completes without deadlock", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()

    // when
    const result = await withInboxConsumerLease(
      teamRunId,
      "m1",
      config,
      async () => await withInboxConsumerLease(
        teamRunId,
        "m1",
        config,
        async () => "nested",
        { staleAfterMs: 300_000 },
      ),
      { staleAfterMs: 300_000 },
    )

    // then
    expect(result).toBe("nested")
  }, 1_000)

  test("#given an unawaited nested call starts before its owner returns w2tc #when the child finishes later #then the outer lease drains it before settling", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const childEntered = createSignal()
    const releaseChild = createSignal()
    const events: string[] = []
    let child: Promise<void> | undefined

    // when
    const outer = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      child = withInboxConsumerLease(teamRunId, "m1", config, async () => {
        events.push("child-entered")
        childEntered.resolve()
        await releaseChild.promise
        events.push("child-finished")
      }, { staleAfterMs: 300_000 })
      events.push("outer-returned")
    }, { staleAfterMs: 300_000 }).then(() => events.push("outer-settled"))
    await childEntered.promise
    releaseChild.resolve()
    await Promise.all([outer, child])

    // then
    expect(events).toEqual(["child-entered", "outer-returned", "child-finished", "outer-settled"])
  }, 1_000)

  test("#given a detached continuation inherits a finished child scope w2tc #when it runs while the outer owner is active #then it reacquires after the outer releases", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const childFinished = createSignal()
    const triggerDetached = createSignal()
    const releaseOuter = createSignal()
    const events: string[] = []
    let detached: Promise<void> | undefined

    const outer = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      await withInboxConsumerLease(teamRunId, "m1", config, async () => {
        detached = (async () => {
          await triggerDetached.promise
          await withInboxConsumerLease(teamRunId, "m1", config, async () => {
            events.push("detached-entered")
          }, { staleAfterMs: 300_000 })
        })()
      }, { staleAfterMs: 300_000 })
      childFinished.resolve()
      await releaseOuter.promise
      events.push("outer-finishing")
    }, { staleAfterMs: 300_000 }).then(() => events.push("outer-settled"))
    await childFinished.promise

    // when
    triggerDetached.resolve()
    releaseOuter.resolve()
    await outer
    if (detached === undefined) throw new Error("detached operation was not initialized")
    await detached

    // then
    expect(events).toEqual(["outer-finishing", "outer-settled", "detached-entered"])
  }, 1_000)

  test("#given inbox A drains an admitted child w2tc #when inbox B acquires its lease #then B completes independently", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const childAEntered = createSignal()
    const releaseChildA = createSignal()
    const events: string[] = []
    let childA: Promise<void> | undefined
    const outerA = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      childA = withInboxConsumerLease(teamRunId, "m1", config, async () => {
        childAEntered.resolve()
        await releaseChildA.promise
        events.push("a-child-finished")
      }, { staleAfterMs: 300_000 })
    }, { staleAfterMs: 300_000 }).then(() => events.push("a-outer-settled"))
    await childAEntered.promise

    // when
    await withInboxConsumerLease(teamRunId, "m2", config, async () => {
      events.push("b-finished")
    }, { staleAfterMs: 300_000 })
    releaseChildA.resolve()
    await Promise.all([outerA, childA])

    // then
    expect(events).toEqual(["b-finished", "a-child-finished", "a-outer-settled"])
  }, 1_000)

  test("#given a continuation inherits a finished nested inbox B scope w2tc #when it requests active ancestor inbox A #then it reacquires A after the outer releases", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const nestedBFinished = createSignal()
    const triggerDetached = createSignal()
    const releaseOuterA = createSignal()
    const events: string[] = []
    let detached: Promise<void> | undefined

    const outerA = withInboxConsumerLease(teamRunId, "m1", config, async () => {
      await withInboxConsumerLease(teamRunId, "m2", config, async () => {
        detached = (async () => {
          await triggerDetached.promise
          await withInboxConsumerLease(teamRunId, "m1", config, async () => {
            events.push("detached-entered-a")
          }, { staleAfterMs: 300_000 })
        })()
      }, { staleAfterMs: 300_000 })
      nestedBFinished.resolve()
      await releaseOuterA.promise
      events.push("outer-a-finishing")
    }, { staleAfterMs: 300_000 }).then(() => events.push("outer-a-settled"))
    await nestedBFinished.promise

    // when
    triggerDetached.resolve()
    releaseOuterA.resolve()
    await outerA
    if (detached === undefined) throw new Error("detached operation was not initialized")
    await detached

    // then
    expect(events).toEqual(["outer-a-finishing", "outer-a-settled", "detached-entered-a"])
  }, 1_000)

  test("#given nested inbox B remains active under inbox A w2tc #when B calls active ancestor A #then the descendant remains reentrant", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()

    // when
    const result = await withInboxConsumerLease(teamRunId, "m1", config, async () => {
      return await withInboxConsumerLease(teamRunId, "m2", config, async () => {
        return await withInboxConsumerLease(teamRunId, "m1", config, async () => "nested-a", {
          staleAfterMs: 300_000,
        })
      }, { staleAfterMs: 300_000 })
    }, { staleAfterMs: 300_000 })

    // then
    expect(result).toBe("nested-a")
  }, 1_000)

  test("#given inbox B acquisition outlives its ancestor A scope w2tc #when B enters after A expires #then B starts a fresh reentrant context", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const blockerBEntered = createSignal()
    const releaseBlockerB = createSignal()
    const blockerB = withInboxConsumerLease(teamRunId, "m2", config, async () => {
      blockerBEntered.resolve()
      await releaseBlockerB.promise
    }, { staleAfterMs: 300_000 })
    await blockerBEntered.promise
    let delayedB: Promise<string> | undefined

    await withInboxConsumerLease(teamRunId, "m1", config, async () => {
      delayedB = withInboxConsumerLease(teamRunId, "m2", config, async () => {
        return await withInboxConsumerLease(teamRunId, "m2", config, async () => "fresh-b", {
          staleAfterMs: 300_000,
        })
      }, { staleAfterMs: 300_000 })
    }, { staleAfterMs: 300_000 })

    // when
    releaseBlockerB.resolve()
    await blockerB
    if (delayedB === undefined) throw new Error("delayed B acquisition was not initialized")
    const result = await delayedB

    // then
    expect(result).toBe("fresh-b")
  }, 1_000)

  test("#given inbox B is active when ancestor A expires w2tc #when B calls itself afterward #then the active leaf remains reentrant", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const nestedBEntered = createSignal()
    const startDescendantB = createSignal()
    let nestedB: Promise<string> | undefined

    await withInboxConsumerLease(teamRunId, "m1", config, async () => {
      nestedB = withInboxConsumerLease(teamRunId, "m2", config, async () => {
        nestedBEntered.resolve()
        await startDescendantB.promise
        return await withInboxConsumerLease(teamRunId, "m2", config, async () => "active-b", {
          staleAfterMs: 300_000,
        })
      }, { staleAfterMs: 300_000 })
      await nestedBEntered.promise
    }, { staleAfterMs: 300_000 })

    // when
    startDescendantB.resolve()
    if (nestedB === undefined) throw new Error("nested B operation was not initialized")
    const result = await nestedB

    // then
    expect(result).toBe("active-b")
  }, 1_000)

  test("#given inbox B stays active after ancestor A expires w2tc #when B calls A #then the inactive A scope is replaced by a real lease", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const inboxADir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    const leaseAPath = path.join(inboxADir, ".consumer.lock")
    const nestedBEntered = createSignal()
    const startDescendantA = createSignal()
    let nestedB: Promise<string> | undefined

    await withInboxConsumerLease(teamRunId, "m1", config, async () => {
      nestedB = withInboxConsumerLease(teamRunId, "m2", config, async () => {
        nestedBEntered.resolve()
        await startDescendantA.promise
        return await withInboxConsumerLease(teamRunId, "m1", config, async () => {
          await readFile(leaseAPath, "utf8")
          return "reacquired-a"
        }, { staleAfterMs: 300_000 })
      }, { staleAfterMs: 300_000 })
      await nestedBEntered.promise
    }, { staleAfterMs: 300_000 })

    // when
    startDescendantA.resolve()
    if (nestedB === undefined) throw new Error("nested B operation was not initialized")
    const result = await nestedB

    // then
    expect(result).toBe("reacquired-a")
  }, 1_000)

  test("#given the team-mailbox barrel w2tc #when its durable recovery surface is loaded #then consumed and lease helpers are exported", async () => {
    // when
    const mailbox = await import("./index")

    // then
    expect(typeof mailbox.isMessageConsumed).toBe("function")
    expect(typeof mailbox.withInboxConsumerLease).toBe("function")
    expect(typeof mailbox.StaleDeliveryReservationError).toBe("function")
  })
})
