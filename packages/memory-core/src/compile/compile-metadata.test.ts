import { describe, expect, it } from "bun:test"
import { compileMemoryBlock } from "./compile"
import { parseCompiledBlock, repoWith } from "./compile.test-support"

describe("compileMemoryBlock", () => {
  it("#given a stable identity and HEAD #when compiled repeatedly #then metadata is identity-only and byte-identical", async () => {
    // given
    const { repo } = await repoWith([])

    // when
    const first = await compileMemoryBlock(repo, { agentId: "stable-agent" })
    const second = await compileMemoryBlock(repo, { agentId: "stable-agent" })

    // then
    expect(second).toBe(first)
    expect(parseCompiledBlock(first).metadata).toEqual({ agentId: "stable-agent" })
    expect(first).not.toContain("CONVERSATION_ID")
    expect(first).not.toContain("previous messages")
    expect(first).not.toContain("user turns since your last memory save")
    expect(first).not.toContain("Soul updated by")
  })
})
