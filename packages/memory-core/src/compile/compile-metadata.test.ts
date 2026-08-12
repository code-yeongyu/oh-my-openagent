import { describe, expect, it } from "bun:test"
import { compileMemoryBlock } from "./compile"
import { memory, NOW, parseCompiledBlock, repoWith } from "./compile.test-support"

describe("compileMemoryBlock", () => {
  it("#given nudge turns #when compiled #then parsed metadata carries the nudge token value only when requested", async () => {
    // given
    const { repo } = await repoWith([])

    // when
    const nudged = parseCompiledBlock(await compileMemoryBlock(repo, {
      agentId: "nudge-agent",
      conversationId: "nudge-conversation",
      previousMessageCount: 2,
      nudgeTurns: 2,
      clock: () => NOW,
    }))
    const quiet = parseCompiledBlock(await compileMemoryBlock(repo, {
      agentId: "nudge-agent",
      conversationId: "nudge-conversation",
      previousMessageCount: 2,
      clock: () => NOW,
    }))

    // then
    expect(nudged.metadata.nudgeTurns).toBe(2)
    expect(quiet.metadata.nudgeTurns).toBeUndefined()
  })

  it("#given a soul notice #when compiled #then parsed metadata carries the short sha only for that compile", async () => {
    // given
    const { repo } = await repoWith([])
    const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

    // when
    const noticed = parseCompiledBlock(await compileMemoryBlock(repo, {
      agentId: "soul-agent",
      conversationId: "soul-conversation",
      previousMessageCount: 2,
      soulNotice: { sha },
      clock: () => NOW,
    }))
    const quiet = parseCompiledBlock(await compileMemoryBlock(repo, {
      agentId: "soul-agent",
      conversationId: "soul-conversation",
      previousMessageCount: 2,
      clock: () => NOW,
    }))

    // then
    expect(noticed.metadata.soulSha).toBe(sha.slice(0, 7))
    expect(quiet.metadata.soulSha).toBeUndefined()
  })
})
