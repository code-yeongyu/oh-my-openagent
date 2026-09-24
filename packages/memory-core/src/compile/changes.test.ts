import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo } from "../git"
import { projectedChangesBetween, revisionExists } from "./changes"

const TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const AUTHOR = { agentId: "changes-agent", authorName: "Changes Agent" }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function createRepo() {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-changes-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nfirst\n" },
      { relativePath: "reference/old.md", content: "---\ndescription: Old\n---\nold\n" },
    ],
  })
  return { dir, repo }
}

async function commitFile(dir: string, repo: GitMemoryRepo, path: string, body: string, message: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), `---\ndescription: ${path}\n---\n${body}\n`)
  await repo.commitWrite([path], message, AUTHOR)
}

describe("projectedChangesBetween", () => {
  it("#given adds, a system edit, an external edit, a removal and a skill #when summarized #then only projected changes are classified", async () => {
    // given
    const { dir, repo } = await createRepo()
    const base = await repo.head()
    await commitFile(dir, repo, "reference/new.md", "new", "add reference")
    await commitFile(dir, repo, "system/persona.md", "second", "edit persona")
    await commitFile(dir, repo, "reference/old.md", "changed body", "edit external body")
    await commitFile(dir, repo, "skills/demo/SKILL.md", "skill", "add skill")
    await unlink(join(dir, "reference/old.md"))
    await repo.commitWrite(["reference/old.md"], "remove old", AUTHOR)

    // when
    const changes = await projectedChangesBetween(repo, base, await repo.head())

    // then
    expect(changes).toEqual({ added: ["reference/new.md"], updated: ["system/persona.md"], removed: ["reference/old.md"] })
  }, TIMEOUT)

  it("#given commits from the excluded session and from another writer #when summarized #then only the other writer's paths remain", async () => {
    // given
    const { dir, repo } = await createRepo()
    const base = await repo.head()
    await commitFile(dir, repo, "reference/mine.md", "mine", "record\n\nOmo-Writer: memory-tool\nOmo-Session: session-a\nOmo-Turn: 1")
    await commitFile(dir, repo, "reference/theirs.md", "theirs", "record\n\nOmo-Writer: memory-tool\nOmo-Session: session-b\nOmo-Turn: 3")

    // when
    const changes = await projectedChangesBetween(repo, base, await repo.head(), { excludeSessionId: "session-a" })

    // then
    expect(changes).toEqual({ added: ["reference/theirs.md"], updated: [], removed: [] })
  }, TIMEOUT)

  it("#given base equal to head #when summarized #then git is not asked and nothing changed", async () => {
    // given
    const { repo } = await createRepo()
    const head = await repo.head()
    const originalLog = repo.log.bind(repo)
    let logCalls = 0
    repo.log = async (options) => {
      logCalls += 1
      return originalLog(options)
    }

    // when
    const changes = await projectedChangesBetween(repo, head, head)

    // then
    expect(changes).toEqual({ added: [], updated: [], removed: [] })
    expect(logCalls).toBe(0)
  }, TIMEOUT)
})

describe("revisionExists", () => {
  it("#given a real commit and an unknown sha #when checked #then only the real commit resolves", async () => {
    // given
    const { repo } = await createRepo()
    const head = await repo.head()

    // when / then
    expect(head).not.toBeNull()
    expect(await revisionExists(repo, head ?? "")).toBe(true)
    expect(await revisionExists(repo, "0123456789abcdef0123456789abcdef01234567")).toBe(false)
  }, TIMEOUT)
})
