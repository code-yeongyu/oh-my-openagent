import { describe, expect, it } from "bun:test"
import { compileMemoryBlock } from "./compile"
import { memory, parseCompiledBlock, repoWith } from "./compile.test-support"

describe("compileMemoryBlock", () => {
  it("#given nested committed memory #when compiled #then block sections, projection order, and metadata values form the structural contract", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY\n") },
      { relativePath: "system/facts.md", content: memory("FACTS_DESCRIPTION", "FACTS_BODY\n") },
      { relativePath: "system/human/prefs/coding.md", content: memory("PREFS_DESCRIPTION", "PREFS_BODY\n") },
      { relativePath: "reference/details.md", content: memory("REFERENCE_DESCRIPTION", "EXTERNAL_BODY_SENTINEL\n") },
      { relativePath: "archive/diagram.png", content: "BINARY_BODY_SENTINEL" },
      { relativePath: "README.MD", content: "UPPERCASE_BODY_SENTINEL" },
      { relativePath: "skills/deploy/SKILL.md", content: memory("SKILL_DESCRIPTION", "SKILL_BODY_SENTINEL\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "agent-golden" })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure).toEqual({
      sections: ["self", "memory", "memory_metadata"],
      projectionPaths: ["system/persona.md", "system/facts.md", "system/human/prefs/coding.md"],
      memoryOpenTags: ["facts", "human", "prefs", "coding", "external_projection"],
      metadata: { agentId: "agent-golden" },
    })
    expect(block).toContain("PERSONA_BODY")
    expect(block).toContain("FACTS_BODY")
    expect(block).toContain("PREFS_BODY")
    expect(block).not.toContain("EXTERNAL_BODY_SENTINEL")
    expect(block).not.toContain("BINARY_BODY_SENTINEL")
    expect(block).not.toContain("SKILL_BODY_SENTINEL")
    // Loaded Windows runners push these git fixtures past the 5s default; the work stays
    // deterministic (~230ms locally), so only the ceiling moves.
  }, 30_000)

  it("#given a committed persona and identity #when compiled #then both projection paths share the self section and metadata remains structured", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY\n") },
      { relativePath: "system/identity.md", content: memory("IDENTITY_DESCRIPTION", "IDENTITY_BODY\n") },
      { relativePath: "system/facts.md", content: memory("FACTS_DESCRIPTION", "FACTS_BODY\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "persona-identity-agent" })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure).toEqual({
      sections: ["self", "memory", "memory_metadata"],
      projectionPaths: ["system/persona.md", "system/identity.md", "system/facts.md"],
      memoryOpenTags: ["facts"],
      metadata: { agentId: "persona-identity-agent" },
    })
  }, 30_000)

  it("#given only a committed identity #when compiled #then it renders under self without a persona projection", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/identity.md", content: memory("IDENTITY_DESCRIPTION", "IDENTITY_BODY\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "identity-agent" })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure.sections).toEqual(["self", "memory_metadata"])
    expect(structure.projectionPaths).toEqual(["system/identity.md"])
  }, 30_000)

  it("#given an empty committed repository #when compiled #then only structured metadata is emitted", async () => {
    // given
    const { repo } = await repoWith([])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "empty-agent" })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure).toEqual({
      sections: ["memory_metadata"],
      projectionPaths: [],
      memoryOpenTags: [],
      metadata: { agentId: "empty-agent" },
    })
  }, 30_000)

  it("#given only a committed persona #when compiled #then its body is projected without its description", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("DESCRIPTION_SENTINEL", "PERSONA_BODY_SENTINEL\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "persona-agent" })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure.sections).toEqual(["self", "memory_metadata"])
    expect(structure.projectionPaths).toEqual(["system/persona.md"])
    expect(block).toContain("PERSONA_BODY_SENTINEL")
    expect(block).not.toContain("DESCRIPTION_SENTINEL")
  }, 30_000)
})
