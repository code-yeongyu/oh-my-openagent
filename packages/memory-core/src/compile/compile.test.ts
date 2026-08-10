import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { compileMemoryBlock } from "./compile"

const tempDirs: string[] = []
const NOW = new Date("2026-05-04T00:00:00.000Z")

async function fixture(name: string): Promise<string> {
  return readFile(join(import.meta.dir, "fixtures", `${name}.golden.txt`), "utf8")
}

async function repoWith(files: Array<{ relativePath: string; content: string }>) {
  const dir = await mkdtemp(join(tmpdir(), "memory-compile-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "fixture-agent" })
  await repo.init({ seedFiles: files })
  return { dir, repo }
}

function memory(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n${body}`
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("compileMemoryBlock", () => {
  it("#given nested committed memory #when compiled #then it matches the handcrafted Letta golden", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("Not projected", "I am a careful coding agent.\n") },
      { relativePath: "system/facts.md", content: memory("Stable facts", "The project uses Bun.\n") },
      { relativePath: "system/human/prefs/coding.md", content: memory("Coding preferences", "Prefer focused changes.\nRun tests once.\n") },
      { relativePath: "reference/details.md", content: memory("Reference", "External body must stay out.\n") },
      { relativePath: "archive/diagram.png", content: "PNG-BODY-MUST-STAY-OUT" },
      { relativePath: "README.MD", content: "UPPERCASE-BODY-MUST-STAY-OUT" },
      { relativePath: "skills/deploy/SKILL.md", content: memory("Deploy", "Skill body must stay out.\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "agent-golden",
      conversationId: "conversation-golden",
      previousMessageCount: 7,
      clock: () => NOW,
    })

    // then
    expect(block).toBe(await fixture("full"))
    expect(block).not.toContain("External body")
    expect(block).not.toContain("SKILL.md")
    expect(block).not.toContain("PNG-BODY")
  })

  it("#given an empty committed repository #when compiled #then only metadata is emitted", async () => {
    // given
    const { repo } = await repoWith([])

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "empty-agent",
      conversationId: "empty-conversation",
      previousMessageCount: 0,
      clock: () => NOW,
    })

    // then
    expect(block).toBe(await fixture("empty"))
  })

  it("#given only a committed persona #when compiled #then its description is omitted", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("Secret description", "Committed persona.\n") },
    ])

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "persona-agent",
      conversationId: "persona-conversation",
      previousMessageCount: 2,
      clock: () => NOW,
    })

    // then
    expect(block).toBe(await fixture("persona-only"))
    expect(block).not.toContain("Secret description")
  })

  it("#given a dirty persona edit #when compiled #then only the committed HEAD body appears", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("Persona", "Committed persona.\n") },
    ])
    await writeFile(join(dir, "system/persona.md"), memory("Persona", "Dirty persona.\n"))

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "persona-agent",
      conversationId: "persona-conversation",
      previousMessageCount: 2,
      clock: () => NOW,
    })

    // then
    expect(block).toContain("Committed persona.")
    expect(block).not.toContain("Dirty persona.")
  })

  it("#given a committed binary projection #when compiled #then its name appears without reading its blob", async () => {
    // given
    const { repo } = await repoWith([{ relativePath: "assets/logo.png", content: "binary payload" }])
    const originalShow = repo.show.bind(repo)
    repo.show = async (revision, path) => {
      if (path.endsWith(".png")) throw new Error("binary blob was read")
      return originalShow(revision, path)
    }

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "binary-agent",
      conversationId: "binary-conversation",
      previousMessageCount: 0,
      clock: () => NOW,
    })

    // then
    expect(block).toContain("└── logo.png")
    expect(block).not.toContain("binary payload")
  })

  it("#given an unreadable committed system file #when compiled #then it is skipped best-effort", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("Persona", "Readable persona.\n") },
      { relativePath: "system/broken.md", content: "missing frontmatter" },
    ])

    // when
    const block = await compileMemoryBlock(repo, {
      agentId: "skip-agent",
      conversationId: "skip-conversation",
      previousMessageCount: 0,
      clock: () => NOW,
    })

    // then
    expect(block).toContain("Readable persona.")
    expect(block).not.toContain("<broken>")
  })
})
