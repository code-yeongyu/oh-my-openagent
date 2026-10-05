import { afterEach, describe, expect, test } from "bun:test"
import { world, removeWorldDirs } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

const posixPrewarmTest = test.skipIf(process.platform === "win32")

describe("the pre-warm is admitted like a spawn: its store is in the agent-dir store index before any host exists", () => {
  posixPrewarmTest("#given a writable store index #when the first prompt warms the host #then the session's store is registered before the shard is ensured", async () => {
    // given
    const w = world({ prewarm: "default" })

    // when
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    expect(w.storeRegisteredAtEnsure).toEqual([true])
    expect(await w.commandsAt(w.host.shardSocket(), "warm")).toHaveLength(1)
  })

  posixPrewarmTest("#given a store index that cannot be written #when every prewarm edge fires #then no shard is ensured or warmed, nothing escapes, and no notice is added", async () => {
    for (const prewarm of ["first-turn", "session-start"] as const) {
      // given
      const w = world({ prewarm, storeIndex: "unavailable" })
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason)
      }
      process.on("unhandledRejection", onUnhandled)

      try {
        // when
        await w.sessionStart("root-1")
        await w.prompt("root-1")
        await w.settled("root-1")

        // then
        expect(w.ensures).toEqual([])
        expect(w.probes).toEqual([])
        expect(w.hostStarted(w.host.shardSocket())).toBe(false)
        expect(w.host.notices.list()).toEqual([])
        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    }
  })
})
