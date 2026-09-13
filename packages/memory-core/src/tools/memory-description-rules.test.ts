import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { MAX_DESCRIPTION_LENGTH } from "../memfs/frontmatter-validation"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { runMemoryTool, type MemoryToolLock, type MemoryToolParams } from "./memory"
import { MemoryToolError } from "./tool-errors"

const AUTHOR: GitCommitAuthor = {
  agentId: "agent-description-rules",
  authorName: "Description Rules Agent",
  authorEmail: "rules@example.com",
}
const LEAKED = 'STANDING RULE: verify identity</description> <parameter name="file_text"># Body that belongs in file_text'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

setDefaultTimeout(process.platform === "win32" ? 30000 : 10000)

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-description-rules-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const lock: MemoryToolLock = async (_domain, operation) => operation()
  return { repo, lock }
}

async function run(setup: Awaited<ReturnType<typeof fixture>>, params: Omit<MemoryToolParams, "author">) {
  return runMemoryTool({ repo: setup.repo, lock: setup.lock, params: { ...params, author: AUTHOR } })
}

async function patch(setup: Awaited<ReturnType<typeof fixture>>, reason: string, input: string) {
  return runMemoryApplyPatch({ repo: setup.repo, lock: setup.lock, params: { reason, input, author: AUTHOR } })
}

async function frontmatterAsSkillLoaderSees(repo: GitMemoryRepo, path: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(repo.dir, path), "utf8")
  return parseYaml(content.slice(4, content.indexOf("\n---", 4))) as Record<string, unknown>
}

describe("memory tool description rules", () => {
  it("#given a description containing tool-call scaffolding #when create runs #then it is rejected as a malformed call and nothing is committed", async () => {
    // #given
    const setup = await fixture()
    const head = await setup.repo.head()

    // #when
    const attempt = run(setup, { command: "create", reason: "leak", file_path: "reference/leak.md", description: LEAKED, file_text: "" })

    // #then
    await expect(attempt).rejects.toBeInstanceOf(MemoryToolError)
    await expect(attempt).rejects.toThrow(/create: .*<\/description>.*malformed/s)
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given a description over the skill loader limit #when update_description runs #then the limit is named", async () => {
    // #given
    const setup = await fixture()
    await run(setup, { command: "create", reason: "seed", file_path: "reference/long.md", description: "Short", file_text: "body" })

    // #when
    const attempt = run(setup, {
      command: "update_description",
      reason: "grow",
      file_path: "reference/long.md",
      description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
    })

    // #then
    await expect(attempt).rejects.toThrow(new RegExp(`update_description: .*${MAX_DESCRIPTION_LENGTH}`))
  })

  it("#given a description with an unquoted ': ' #when create runs #then the committed file is valid YAML for the skill loader", async () => {
    // #given
    const setup = await fixture()
    const description = "Use when shipping. Always run the chain by default: verify, merge"

    // #when
    await run(setup, { command: "create", reason: "skill", file_path: "skills/ship/SKILL.md", description, file_text: "# Ship\n" })

    // #then
    expect(await frontmatterAsSkillLoaderSees(setup.repo, "skills/ship/SKILL.md")).toEqual({ description })
  })

  it("#given a SKILL.md with name and version #when its body is edited through str_replace #then name and version survive", async () => {
    // #given
    const setup = await fixture()
    const content = "---\nname: ship\ndescription: Use when shipping\nversion: 0.2.0\n---\n# Ship\nold step\n"
    await patch(
      setup,
      "seed skill",
      `*** Begin Patch\n*** Add File: skills/ship/SKILL.md\n${content.split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch`,
    )

    // #when
    await run(setup, { command: "str_replace", reason: "edit", file_path: "skills/ship/SKILL.md", old_string: "old step", new_string: "new step" })

    // #then
    expect(await frontmatterAsSkillLoaderSees(setup.repo, "skills/ship/SKILL.md")).toEqual({
      description: "Use when shipping",
      name: "ship",
      version: "0.2.0",
    })
    expect(parseMemoryFile(await readFile(join(setup.repo.dir, "skills/ship/SKILL.md"), "utf8")).body).toContain("new step")
  })

  it("#given an apply_patch update that rewrites the description with an unquoted ': ' #when applied #then the written frontmatter is normalized", async () => {
    // #given
    const setup = await fixture()
    await run(setup, { command: "create", reason: "seed", file_path: "reference/notes.md", description: "Notes", file_text: "body" })

    // #when
    await patch(
      setup,
      "retitle",
      "*** Begin Patch\n*** Update File: reference/notes.md\n@@\n-description: Notes\n+description: Notes by default: verify\n*** End Patch",
    )

    // #then
    expect(await frontmatterAsSkillLoaderSees(setup.repo, "reference/notes.md")).toEqual({ description: "Notes by default: verify" })
  })

  it("#given an apply_patch update whose description carries scaffolding #when applied #then it is rejected", async () => {
    // #given
    const setup = await fixture()
    await run(setup, { command: "create", reason: "seed", file_path: "reference/notes.md", description: "Notes", file_text: "body" })

    // #when
    const attempt = patch(
      setup,
      "leak",
      `*** Begin Patch\n*** Update File: reference/notes.md\n@@\n-description: Notes\n+description: ${LEAKED}\n*** End Patch`,
    )

    // #then
    await expect(attempt).rejects.toThrow(/malformed/)
  })
})
