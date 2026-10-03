import { afterEach, describe, expect, test } from "bun:test"

import { world, countingGateWorld, sockets, suspendedChild, removeWorldDirs } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

// The session's own-shard pre-warm is POSIX-only by the rpc-host-sharding plan (todo 9: "platform is not
// win32"; Must NOT: "pre-warm on win32"): these cases resolve the session's shard through the POSIX socket
// layout (sun_path limit, owner-checked /tmp alternate root), which a win32 filesystem cannot host. The
// win32 case below still runs everywhere and pins that nothing is ensured there.
const posixPrewarmTest = test.skipIf(process.platform === "win32")

describe("task.host_shard_prewarm warms the session's own host", () => {
  posixPrewarmTest("#given session-start #when session_start fires #then the session's shard is ensured once, before any spawn", async () => {
    // given
    const w = world({ prewarm: "session-start" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
    expect(w.ensures[0]?.owner?.ownerSessionId).toBe("root-1")
    expect(await w.host.executionModeGate.ensure()).toBe("process")
    expect(w.ensures).toHaveLength(1)
  })

  posixPrewarmTest("#given first-turn #when session_start then two prompts fire #then nothing at session_start and exactly one ensure on the first prompt", async () => {
    // given
    const w = world({ prewarm: "first-turn" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")
    const atSessionStart = w.ensures.length
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.settled("root-1")
    const afterFirstTurn = w.ensures.length
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.settled("root-1")

    // then
    expect(atSessionStart).toBe(0)
    expect(afterFirstTurn).toBe(1)
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
  })

  posixPrewarmTest("#given the default settings #when a top-level session starts and then prompts #then its host warms on the first prompt, not at session_start", async () => {
    // given
    const w = world({ prewarm: "default" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")
    const atSessionStart = w.ensures.length
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    expect(atSessionStart).toBe(0)
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
  })

  posixPrewarmTest("#given first-turn and a turn that skips input #when before_agent_start fires #then that turn warms the host", async () => {
    // given
    const w = world({ prewarm: "first-turn" })
    await w.sessionStart("root-1")

    // when
    await w.agentStart("root-1")
    await w.settled("root-1")

    // then
    expect(w.ensures).toHaveLength(1)
  })

  test("#given off and no suspended children #when session_start and a prompt fire #then no host is ensured", async () => {
    // given
    const w = world({ prewarm: "off" })

    // when
    await w.sessionStart("root-1")
    await w.prompt("root-1")
    await w.agentStart("root-1")

    // then
    expect(w.ensures).toEqual([])
  })

  test("#given win32 or the child-process runner #when every prewarm edge fires #then nothing is ensured", async () => {
    for (const variant of [{ platform: "win32" as const }, { processRunner: "child-process" as const }]) {
      // given
      const w = world({ prewarm: "session-start", ...variant })
      w.records.push(suspendedChild("root-1", w.shard("p-aaaaaaaaaaaaaaaa")))

      // when
      await w.sessionStart("root-1")
      await w.prompt("root-1")

      // then
      expect(w.ensures).toEqual([])
      expect(w.pi.handlers.map((entry) => entry.event)).toEqual([])
    }
  })

  test("#given first-turn #when every prompt edge of two turns fires #then the gate is asked once per session id", async () => {
    // given
    const w = countingGateWorld({ prewarm: "first-turn", gate: () => Promise.resolve("process") })

    // when
    await w.sessionStart("root-1")
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.prompt("root-2")
    await Promise.all([w.settled("root-1"), w.settled("root-2")])

    // then
    expect(w.calls).toEqual(["gate", "gate"])
  })

  test("#given first-turn and turn contexts that carry no session manager #when two turns start #then the gate is still asked once", async () => {
    // given
    const w = countingGateWorld({ prewarm: "first-turn", gate: () => Promise.resolve("process") })
    await w.sessionStart("root-1")

    // when
    await w.bareTurn()
    await w.bareTurn()
    await w.settled("root-1")

    // then
    expect(w.calls).toEqual(["gate"])
  })

  test("#given first-turn already fired for a session #when later prompts of that session arrive #then their context is not captured again", async () => {
    // given
    const w = countingGateWorld({ prewarm: "first-turn", gate: () => Promise.resolve("process") })
    await w.sessionStart("root-1")
    await w.prompt("root-1")
    const capturesAtFirstFire = [...w.captures]

    // when
    await w.agentStart("root-1")
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.prompt("root-2")

    await Promise.all([w.settled("root-1"), w.settled("root-2")])

    // then: only the new session's first prompt is captured
    expect(capturesAtFirstFire).toEqual(["root-1", "root-1"])
    expect(w.captures).toEqual(["root-1", "root-1", "root-2"])
    expect(w.calls).toEqual(["gate", "gate"])
  })

  test("#given a gate whose ensure rejects #when first-turn warms #then the rejection is absorbed, never unhandled", async () => {
    // given
    const w = countingGateWorld({ prewarm: "first-turn", gate: () => Promise.reject(new Error("gate exploded")) })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)

    try {
      // when
      await w.prompt("root-1")
      await w.settled("root-1")

      // then
      expect(w.calls).toEqual(["gate"])
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  posixPrewarmTest("#given an ensure that rejects #when session-start warms #then no unhandled rejection escapes, the warm adds no notice, and the spawn's own ensure reports it", async () => {
    // given
    const w = world({ prewarm: "session-start", ensure: "reject" })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)

    try {
      // when
      await w.sessionStart("root-1")
      await w.settled("root-1")
      const noticesAfterWarm = w.host.notices.list()
      const mode = await w.host.executionModeGate.ensure()

      // then
      expect(noticesAfterWarm).toEqual([])
      expect(mode).toBe("in-process")
      expect(w.ensures).toHaveLength(2)
      expect(unhandled).toEqual([])
      expect(w.host.notices.list().some((notice) => notice.startsWith("host_unavailable:"))).toBe(true)
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  posixPrewarmTest("#given a warm whose ensure fails once #when the first child's ensure runs #then it asks the host again and routes to process", async () => {
    // given
    const w = world({ prewarm: "session-start", ensure: "reject-once" })
    await w.sessionStart("root-1")
    await w.settled("root-1")

    // when
    const mode = await w.host.executionModeGate.ensure()

    // then
    expect(mode).toBe("process")
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket(), w.host.shardSocket()])
    expect(w.host.notices.list()).toEqual([])
  })

  test("#given an omo-spawned session (child or per-process child) #when every prewarm edge fires #then its own host is never warmed", async () => {
    for (const variant of [{ sessionRole: "child" }, { ownShard: "p-aaaaaaaaaaaaaaaa" }]) {
      for (const prewarm of ["session-start", "first-turn"] as const) {
        // given
        const w = world({ prewarm, ...variant })

        // when
        await w.sessionStart("child-1")
        await w.prompt("child-1")
        await w.agentStart("child-1")

        // then
        expect(w.ensures).toEqual([])
        expect(w.probes).toEqual([])
      }
    }
  })

  test("#given default_execution_mode in-process #when every prewarm edge fires #then no host is ensured", async () => {
    for (const prewarm of ["session-start", "first-turn"] as const) {
      // given
      const w = world({ prewarm, defaultExecutionMode: "in-process" })

      // when
      await w.sessionStart("root-1")
      await w.prompt("root-1")

      // then
      expect(w.ensures).toEqual([])
    }
  })

  posixPrewarmTest("#given default_execution_mode process #when session-start warms #then the session's shard is ensured", async () => {
    // given
    const w = world({ prewarm: "session-start", defaultExecutionMode: "process" })

    // when
    await w.sessionStart("root-1")
    await w.settled("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
  })
})
