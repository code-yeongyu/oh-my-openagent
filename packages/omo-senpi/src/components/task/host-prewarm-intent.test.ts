import { afterEach, describe, expect, test } from "bun:test"

import { world, sockets, removeWorldDirs } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

const posixPrewarmTest = test.skipIf(process.platform === "win32")

describe("a session inside a Desktop thread host warms its child shard on the first delegation intent", () => {
  posixPrewarmTest("#given a Desktop thread session at the default #when it starts and prompts #then nothing is ensured", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true })

    // when
    await w.sessionStart("root-1")
    await w.prompt("root-1")
    await w.agentStart("root-1")
    await w.settled("root-1")

    // then
    expect(w.ensures).toEqual([])
  })

  posixPrewarmTest("#given a Desktop thread session that prompted #when the model starts streaming a task call #then its shard is ensured and warmed exactly once", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true })
    await w.sessionStart("root-1")
    await w.prompt("root-1")

    // when
    await w.toolCallStart("root-1", "task")
    await w.settled("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
    expect(w.ensures[0]?.owner?.ownerSessionId).toBe("root-1")
    expect(await w.commandsAt(w.host.shardSocket(), "warm")).toHaveLength(1)
  })

  posixPrewarmTest("#given a Desktop thread session that already warmed on intent #when more task and task_send calls start #then nothing more is ensured or warmed", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true })
    await w.toolCallStart("root-1", "task")
    await w.settled("root-1")

    // when
    await w.toolCallStart("root-1", "task")
    await w.toolCallStart("root-1", "task_send")
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    expect(w.ensures).toHaveLength(1)
    expect(await w.commandsAt(w.host.shardSocket(), "warm")).toHaveLength(1)
  })

  posixPrewarmTest("#given a Desktop thread session #when a task_send call starts #then that intent warms the shard too", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true })

    // when
    await w.toolCallStart("root-1", "task_send")
    await w.settled("root-1")

    // then
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
  })

  posixPrewarmTest("#given a Desktop thread session #when a non-delegating tool call starts #then nothing is ensured", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true })

    // when
    await w.toolCallStart("root-1", "read")
    await w.toolCallStart("root-1", "task_output")
    await w.settled("root-1")

    // then
    expect(w.ensures).toEqual([])
  })

  posixPrewarmTest("#given a Desktop thread session with the store index unavailable #when a task call starts #then nothing is ensured", async () => {
    // given
    const w = world({ prewarm: "default", desktopThread: true, storeIndex: "unavailable" })

    // when
    await w.toolCallStart("root-1", "task")
    await w.settled("root-1")

    // then
    expect(w.ensures).toEqual([])
    expect(w.host.notices.list()).toEqual([])
  })

  posixPrewarmTest("#given a terminal session at the default #when a task call starts before its first prompt reaches the host #then it keeps first-turn: the prompt warms, the tool call does not", async () => {
    // given
    const w = world({ prewarm: "default" })
    await w.sessionStart("root-1")

    // when
    await w.toolCallStart("root-1", "task")
    const afterToolCall = w.ensures.length
    await w.prompt("root-1")
    await w.settled("root-1")

    // then
    expect(afterToolCall).toBe(0)
    expect(sockets(w.ensures)).toEqual([w.host.shardSocket()])
  })

  test("#given a Desktop thread session with the pre-warm off #when a task call starts #then nothing is ensured", async () => {
    // given
    const w = world({ prewarm: "off", desktopThread: true })

    // when
    await w.toolCallStart("root-1", "task")
    await w.settled("root-1")

    // then
    expect(w.ensures).toEqual([])
  })
})
