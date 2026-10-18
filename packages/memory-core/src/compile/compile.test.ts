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

  it("#given a compiled projection #when the reminder is read #then it states exactly once that recalled memory arrives on its own with no tool to call", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY\n") },
    ])
    const sentence = "Relevant stored memory arrives on its own as <recalled-memory> blocks; there is no recall tool to call."

    // when
    const block = await compileMemoryBlock(repo, { agentId: "reminder-agent" })

    // then
    expect(block.split(sentence)).toHaveLength(2)
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

const PRE_CHANGE_CLEAN_BLOCK: string = "Reminder: <projection> holds local paths of memory projections. <memory> is your persistent memory across conversations. Consult it BEFORE asking the user anything it may already answer. Save durable facts, preferences, decisions, and corrections with the memory tools THE MOMENT they emerge. Route facts about a person to their record under people/ (the primary human's card is system/human.md). Relevant stored memory arrives on its own as <recalled-memory> blocks; there is no recall tool to call.\n\n<memory>\n<human>\n  <projection>$MEMORY_DIR/system/human.md</projection>\n  <description>HUMAN_DESCRIPTION</description>\n  Prefers concise answers.\n</human>\n<external_projection>\n$MEMORY_DIR/\nreference/: notes.md\n</external_projection>\n</memory>\n\n<memory_metadata>\n- AGENT_ID: boundary-agent\n</memory_metadata>"

describe("compileMemoryBlock secret screening", () => {
  it("#given a system file whose body and description carry secret-like text #when compiled #then both are masked and the block is deterministic across compiles", async () => {
    // given
    const ghpToken = "ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5"
    const { repo } = await repoWith([
      { relativePath: "system/human.md", content: memory(ghpToken, "prefers password=Hunter2Hunter2 in examples\n") },
    ])

    // when
    const first = await compileMemoryBlock(repo, { agentId: "secret-body-agent" })
    const second = await compileMemoryBlock(repo, { agentId: "secret-body-agent" })

    // then
    expect(first).toBe(second)
    expect(first).toContain("***")
    expect(first).not.toContain("Hunter2Hunter2")
    expect(first).not.toContain(ghpToken)
  }, 30_000)

  it("#given a clean system file #when compiled #then the block is byte-identical to the pre-change renderer output", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/human.md", content: memory("HUMAN_DESCRIPTION", "Prefers concise answers.\n") },
      { relativePath: "reference/notes.md", content: memory("NOTES_DESCRIPTION", "External note body.\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, { agentId: "boundary-agent" })

    // then
    expect(block).toBe(PRE_CHANGE_CLEAN_BLOCK)
  }, 30_000)

  it("#given committed files with secret-like names #when compiled #then every rendered path, label and name is masked", async () => {
    // given: legacy content committed before the commit gate existed, seeded with raw git
    const ghpToken = "ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5"
    const { dir, repo } = await repoWith([])
    await Bun.write(`${dir}/system/token=abc123456.md`, memory("CLEAN_DESCRIPTION", "CLEAN_BODY\n"))
    await Bun.write(`${dir}/reference/${ghpToken}.md`, memory("REFERENCE_DESCRIPTION", "REFERENCE_BODY\n"))
    await Bun.$`git -C ${dir} add -A`
    await Bun.$`git -C ${dir} -c user.email=fixture@example.com -c user.name=fixture commit -qm "legacy secret names"`

    // when
    const first = await compileMemoryBlock(repo, { agentId: "secret-name-agent" })
    const second = await compileMemoryBlock(repo, { agentId: "secret-name-agent" })

    // then
    expect(first).toBe(second)
    expect(first).not.toContain("abc123456")
    expect(first).not.toContain(ghpToken)
    expect(first).toContain("$MEMORY_DIR/system/***.md")
    expect(first).toContain("reference/: ***.md")
  }, 30_000)
})
