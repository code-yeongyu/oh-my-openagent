import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo } from "../git"
import { validateCompletion } from "./completion-validation"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"

const roots: string[] = []
const AUTHOR = { agentId: "agent-one", authorName: "Reflection Agent" }
const LEGACY = "---\ndescription: Run the chain by default: verify, merge\n---\n\nlegacy body\n"

setDefaultTimeout(process.platform === "win32" ? 20_000 : 5_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(seedFiles: Record<string, string> = {}) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-frontmatter-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
  await repo.init({
    seedFiles: Object.entries(seedFiles).map(([relativePath, content]) => ({ relativePath, content })),
  })
  const worktree = await createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
  return { repo, worktree }
}

async function commit(worktree: ReflectionWorktree, path: string, content: string) {
  const target = join(worktree.dir, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
  const child = new GitMemoryRepo({ dir: worktree.dir, agentId: AUTHOR.agentId })
  await child.commitWrite([path], `reflect ${path}`, AUTHOR)
}

describe("reflection completion frontmatter gate", () => {
  it("#given a reflection that writes a SKILL.md with an unquoted ': ' description #when validated #then it fails naming the path", async () => {
    // #given
    const { worktree } = await fixture()
    await commit(worktree, "skills/deploy/SKILL.md", "---\nname: deploy\ndescription: Use by default: verify\n---\n\nsteps\n")

    // #when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // #then
    expect(result.status).toBe("failed")
    expect(result.status === "failed" ? result.detail : "").toContain("skills/deploy/SKILL.md")
    expect(result.status === "failed" ? result.detail : "").toContain("not a safe YAML plain scalar")
  })

  it("#given a reflection that writes a reference note without a description #when validated #then it fails", async () => {
    // #given
    const { worktree } = await fixture()
    await commit(worktree, "reference/note.md", "---\nkind: note\n---\n\nbody\n")

    // #when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // #then
    expect(result.status).toBe("failed")
    expect(result.status === "failed" ? result.detail : "").toContain("reference/note.md")
  })

  it("#given a legacy file whose body is edited but whose frontmatter is untouched #when validated #then it stays valid", async () => {
    // #given
    const { worktree } = await fixture({ "reference/legacy.md": LEGACY })
    await commit(worktree, "reference/legacy.md", LEGACY.replace("legacy body", "edited body"))

    // #when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // #then
    expect(result.status).toBe("valid")
  })

  it("#given a legacy file whose invalid frontmatter is re-touched #when validated #then it fails", async () => {
    // #given
    const { worktree } = await fixture({ "reference/legacy.md": LEGACY })
    await commit(worktree, "reference/legacy.md", LEGACY.replace("verify, merge", "verify, test, merge"))

    // #when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // #then
    expect(result.status).toBe("failed")
    expect(result.status === "failed" ? result.detail : "").toContain("reference/legacy.md")
  })

  it("#given a reflection that writes strict frontmatter and deletes a file #when validated #then it is valid", async () => {
    // #given
    const { worktree } = await fixture({ "reference/old.md": LEGACY })
    await commit(worktree, "skills/deploy/SKILL.md", '---\nname: deploy\ndescription: "Use by default: verify"\nversion: 0.1.0\n---\n\nsteps\n')
    await rm(join(worktree.dir, "reference/old.md"))
    const child = new GitMemoryRepo({ dir: worktree.dir, agentId: AUTHOR.agentId })
    await child.commitWrite(["reference/old.md"], "forget", AUTHOR)

    // #when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // #then
    expect(result.status).toBe("valid")
    expect(result.status === "valid" ? [...result.changedPaths].sort() : []).toEqual(["reference/old.md", "skills/deploy/SKILL.md"])
  })
})
