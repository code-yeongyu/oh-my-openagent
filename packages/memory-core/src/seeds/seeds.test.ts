import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { compileMemoryBlock } from "../compile"
import {
  DEFAULT_MEMORY_BLOCK_LABELS,
  buildDefaultSeedFiles,
  initMemoryWithSeeds,
} from "./seeds"

const exec = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createRepo(agentId = "seed-agent"): Promise<{ dir: string; repo: GitMemoryRepo }> {
  const dir = await mkdtemp(join(tmpdir(), "omo-seeds-"))
  tempDirs.push(dir)
  return { dir, repo: new GitMemoryRepo({ dir, agentId }) }
}

async function gitLog(dir: string, format: string): Promise<string> {
  const result = await exec("git", ["log", `--format=${format}`], { cwd: dir })
  return result.stdout.trim()
}

describe("default memory seeds", () => {
  describe("#given the default block label constants", () => {
    it("#then they are persona and human in order", () => {
      expect(DEFAULT_MEMORY_BLOCK_LABELS).toEqual(["persona", "human"])
    })
  })

  describe("#given buildDefaultSeedFiles", () => {
    it("#then it produces two files with system/ paths and frontmatter", () => {
      const files = buildDefaultSeedFiles()

      expect(files).toHaveLength(2)
      const paths = files.map((f) => f.relativePath)
      expect(paths).toContain("system/persona.md")
      expect(paths).toContain("system/human.md")
    })

    it("#then every seed file has valid frontmatter with a description", () => {
      const files = buildDefaultSeedFiles()

      for (const file of files) {
        const parsed = parseMemoryFile(file.content)
        expect(parsed.frontmatter.description.trim().length).toBeGreaterThan(0)
        expect(parsed.body.length).toBeGreaterThan(0)
      }
    })

    it("#then the persona description is 'Persona - who I am'", () => {
      const files = buildDefaultSeedFiles()
      const persona = files.find((f) => f.relativePath === "system/persona.md")!

      expect(parseMemoryFile(persona.content).frontmatter.description).toBe(
        "Persona - who I am",
      )
    })

    it("#then the human description is 'Human - what I know about the user'", () => {
      const files = buildDefaultSeedFiles()
      const human = files.find((f) => f.relativePath === "system/human.md")!

      expect(parseMemoryFile(human.content).frontmatter.description).toBe(
        "Human - what I know about the user",
      )
    })

    it("#then the persona body mentions the memory directory and system projection", () => {
      const files = buildDefaultSeedFiles()
      const persona = files.find((f) => f.relativePath === "system/persona.md")!
      const body = parseMemoryFile(persona.content).body

      expect(body.toLowerCase()).toContain("$memory_dir")
      expect(body.toLowerCase()).toContain("system/")
    })

    it("#then the persona body has no letta branding", () => {
      const files = buildDefaultSeedFiles()
      const persona = files.find((f) => f.relativePath === "system/persona.md")!
      const body = parseMemoryFile(persona.content).body.toLowerCase()

      expect(body).not.toContain("letta")
    })

    it("#then the persona body has no emojis", () => {
      const files = buildDefaultSeedFiles()
      const persona = files.find((f) => f.relativePath === "system/persona.md")!
      const body = parseMemoryFile(persona.content).body

      // Reject any code point in the emoji/pictograph Unicode ranges.
      const hasEmoji = /\p{Extended_Pictographic}/u.test(body)
      expect(hasEmoji).toBe(false)
    })

    it("#then the human body is a template to be learned (not empty, invites learning)", () => {
      const files = buildDefaultSeedFiles()
      const human = files.find((f) => f.relativePath === "system/human.md")!
      const body = parseMemoryFile(human.content).body

      expect(body.trim().length).toBeGreaterThan(0)
      expect(body.toLowerCase()).not.toContain("letta")
    })
  })

  describe("#given a fresh repository #when initMemoryWithSeeds runs #then it commits two seeded files in one initial commit", async () => {
    // given
    const { dir, repo } = await createRepo()

    // when
    const sha = await initMemoryWithSeeds(repo, { authorName: "Seed Test Agent" })

    // then
    expect(sha).toMatch(/^[0-9a-f]{40,64}$/)

    const tree = await repo.lsTree()
    expect(tree).toContain("system/persona.md")
    expect(tree).toContain("system/human.md")
    expect(tree).toHaveLength(2)

    const commitSubject = await gitLog(dir, "%s")
    expect(commitSubject).toBe("chore: initialize local memory")

    const commitLines = (await gitLog(dir, "oneline")).split("\n").filter(Boolean)
    expect(commitLines).toHaveLength(1)
  })

  describe("#given a fresh repository #when initMemoryWithSeeds runs without authorName #then it uses the default agent name", async () => {
    // given
    const { repo } = await createRepo()

    // when
    const sha = await initMemoryWithSeeds(repo)

    // then
    expect(sha).toMatch(/^[0-9a-f]{40,64}$/)
  })

  describe("#given an existing repo with commits #when initMemoryWithSeeds runs #then it is a no-op (HEAD unchanged)", async () => {
    // given
    const { dir, repo } = await createRepo()
    const originalHead = await initMemoryWithSeeds(repo, { authorName: "First Agent" })
    await writeFile(join(dir, "system/persona.md"), "---\ndescription: x\n---\nCustom\n")
    await repo.commitWrite(["system/persona.md"], "user edit", {
      agentId: "seed-agent",
      authorName: "User",
    })
    const headBefore = await repo.head()

    // when
    const result = await initMemoryWithSeeds(repo, { authorName: "Second Agent" })

    // then
    expect(await repo.head()).toBe(headBefore)
    expect(await repo.head()).toBe(result)
    expect(result).not.toBe(originalHead)

    // The tree should still reflect the user's edit, not re-seeded content.
    const personaContent = await repo.show("HEAD", "system/persona.md")
    expect(personaContent).toContain("Custom")
  })

  describe("#given seeded content #when compiled via the memory compiler #then the persona body is visible in the compiled block", async () => {
    // given
    const { repo } = await createRepo()

    // when
    await initMemoryWithSeeds(repo, { authorName: "Compiler Agent" })
    const block = await compileMemoryBlock(repo, {
      agentId: "seed-agent",
      conversationId: "conv-seed",
      previousMessageCount: 0,
    })

    // then
    expect(block).toContain("<self>")
    expect(block).toContain("$MEMORY_DIR/system/persona.md</projection>")
    expect(block).toContain("<memory_metadata>")
  })
})
