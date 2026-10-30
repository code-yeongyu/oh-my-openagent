import { afterEach, describe, expect, test } from "bun:test"

import { world, sockets, removeWorldDirs } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

// The warm follows the session's own-shard pre-warm, which is POSIX-only by the plan (todo 9: "platform
// is not win32"): these cases resolve the shard through the POSIX socket layout (sun_path limit,
// owner-checked /tmp alternate root), which a win32 filesystem cannot host.
const posixWarmTest = test.skipIf(process.platform === "win32")

function contextOf(command: { readonly payload: Readonly<Record<string, unknown>> } | undefined): unknown {
  return command?.payload["context"]
}

describe("the pre-warm loads the child session services on the host it warmed", () => {
  posixWarmTest("#given the default settings #when the first prompt warms the host #then one child-shaped warm command reaches the session's own shard, in its cwd, and no session opens there", async () => {
    // given
    const w = world({ prewarm: "default" })
    await w.sessionStart("root-1")

    // when
    await w.prompt("root-1")
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    const shard = w.host.shardSocket()
    const warms = await w.commandsAt(shard, "warm")
    expect(warms).toHaveLength(1)
    expect(warms[0]?.payload["cwd"]).toBe(w.root)
    expect(warms[0]?.payload["kind"]).toBe("worker")
    expect(contextOf(warms[0])).toMatchObject({ role: "child", host_warmup: "1" })
    expect(await w.commandsAt(shard, "open_session")).toEqual([])
  })

  posixWarmTest("#given session-start #when session_start warms the host #then the warm command follows the ensure", async () => {
    // given
    const w = world({ prewarm: "session-start" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
    expect(await w.commandsAt(w.host.shardSocket(), "warm")).toHaveLength(1)
  })

  posixWarmTest("#given an engine from before the warm command #when the pre-warm runs #then it falls back to one warm-up session, opened and closed on the shard", async () => {
    // given
    const w = world({ prewarm: "first-turn", warm: { refuse: "missing_session_id" } })

    // when
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    const shard = w.host.shardSocket()
    expect(await w.commandsAt(shard, "warm")).toHaveLength(1)
    const opens = await w.commandsAt(shard, "open_session")
    expect(opens).toHaveLength(1)
    expect(contextOf(opens[0])).toMatchObject({ role: "child", host_warmup: "1" })
    expect(opens[0]?.payload["retain_on_disconnect"]).toBe(false)
    expect(await w.commandsAt(shard, "close_session")).toHaveLength(1)
    expect(w.host.notices.list()).toEqual([])
  })

  posixWarmTest("#given a host that could not be ensured #when the pre-warm runs #then no warm is attempted", async () => {
    // given
    const w = world({ prewarm: "session-start", ensure: "reject" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")

    // then
    expect(w.ensures).toHaveLength(1)
    expect(w.hostStarted(w.host.shardSocket())).toBe(false)
  })

  posixWarmTest("#given a host that refuses the warm #when the pre-warm runs #then nothing escapes, no session opens, and the first child still routes to the host", async () => {
    // given
    const w = world({ prewarm: "first-turn", warm: { refuse: "host_draining" } })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)

    try {
      // when
      await w.prompt("root-1")
      await w.settled("root-1")
      const mode = await w.host.executionModeGate.ensure()

      // then
      expect(unhandled).toEqual([])
      expect(mode).toBe("process")
      expect(w.ensures).toHaveLength(1)
      expect(await w.commandsAt(w.host.shardSocket(), "open_session")).toEqual([])
      expect(w.host.notices.list()).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("#given an omo-spawned session #when every prewarm edge fires #then nothing is warmed", async () => {
    // given
    const w = world({ prewarm: "session-start", sessionRole: "child" })

    // when
    await w.sessionStart("child-1")
    await w.prompt("child-1")
    await w.settled("child-1")

    // then
    expect(w.ensures).toEqual([])
  })
})
