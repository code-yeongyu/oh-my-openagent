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

  test("#given the team-mailbox barrel w2tc #when its durable recovery surface is loaded #then consumed and lease helpers are exported", async () => {
    // when
    const mailbox = await import("./index")

    // then
    expect(typeof mailbox.isMessageConsumed).toBe("function")
    expect(typeof mailbox.withInboxConsumerLease).toBe("function")
  })
})
