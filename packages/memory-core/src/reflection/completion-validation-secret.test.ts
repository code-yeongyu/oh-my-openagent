import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { validateCompletion } from "./completion-validation"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

const roots: string[] = []
const AUTHOR = { agentId: "agent-one", authorName: "Reflection Agent" }
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk\n-----END RSA PRIVATE KEY-----\n"
const GHP = "ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5"
const XOXB = "xoxb-1234567890abcdefghij"

setDefaultTimeout(process.platform === "win32" ? 30_000 : 20_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(seedFiles: Record<string, string> = {}) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-secret-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
  await repo.init({
    seedFiles: Object.entries(seedFiles).map(([relativePath, content]) => ({ relativePath, content })),
  })
  const worktree = await createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
  return { repo, worktree }
}

/** Maintenance children commit through git directly; the history scan exists for exactly those commits. */
async function rawCommit(dir: string, paths: readonly string[], message: string): Promise<string> {
  const exec = createNodeGitExec()
  await exec.run(["add", "-A", "--", ...paths], { cwd: dir, timeoutMs: 30_000 })
  await exec.run(
    ["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message],
    { cwd: dir, timeoutMs: 30_000 },
  )
  const head = await exec.run(["rev-parse", "HEAD"], { cwd: dir, timeoutMs: 30_000 })
  return head.stdout.trim()
}

async function writeAt(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content)
}

async function failureDetail(result: Awaited<ReturnType<typeof validateCompletion>>): Promise<string> {
  expect(result.status).toBe("failed")
  return result.status === "failed" ? result.detail : ""
}

describe("reflection completion secret screening", () => {
  it("#given a submodule whose path is secret-like #when validated #then it fails without echoing the path", async () => {
    // given: a gitlink recorded straight into the index, the way a maintenance child could add one
    const { worktree } = await fixture()
    const exec = createNodeGitExec()
    const head = (await exec.run(["rev-parse", "HEAD"], { cwd: worktree.dir, timeoutMs: 30_000 })).stdout.trim()
    await exec.run(["update-index", "--add", "--cacheinfo", `160000,${head},reference/token=abc123456`], { cwd: worktree.dir, timeoutMs: 30_000 })
    // an empty directory is an uninitialised submodule checkout, so the worktree stays clean
    await mkdir(join(worktree.dir, "reference/token=abc123456"), { recursive: true })
    await exec.run(["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", "add gitlink"], { cwd: worktree.dir, timeoutMs: 30_000 })

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toContain("(submodule, file type)")
    expect(detail).not.toContain("abc123456")
  })

  it("#given a worktree whose changed file carries a PEM block #when validated #then it fails with the class and short sha and no merge happens", async () => {
    // given
    const { repo, worktree } = await fixture()
    const base = await repo.head()
    await writeAt(worktree.dir, "reference/y.md", `---\ndescription: Y\n---\n\n${PEM}`)
    const sha = await rawCommit(worktree.dir, ["reference/y.md"], "add y")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/y.md (pem_block) @${sha.slice(0, 7)}`)
    expect(detail).not.toContain("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk")
    expect(await repo.head()).toBe(base)
  })

  it("#given a changed file whose frontmatter description carries a vendor token #when validated #then the full file content is refused", async () => {
    // given
    const { repo, worktree } = await fixture()
    const base = await repo.head()
    await writeAt(worktree.dir, "reference/y.md", `---\ndescription: ${GHP}\n---\n\nclean body\n`)
    const sha = await rawCommit(worktree.dir, ["reference/y.md"], "add y")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/y.md (vendor_token) @${sha.slice(0, 7)}`)
    expect(detail).not.toContain(GHP)
    expect(await repo.head()).toBe(base)
  })

  it("#given a two-commit branch whose tip is clean but whose first commit carried a credential #when validated #then it fails naming the introducing commit", async () => {
    // given
    const { repo, worktree } = await fixture()
    const base = await repo.head()
    await writeAt(worktree.dir, "reference/z.md", "---\ndescription: Z\n---\n\ntoken=abc123456\n")
    const first = await rawCommit(worktree.dir, ["reference/z.md"], "add z")
    await writeAt(worktree.dir, "reference/z.md", "---\ndescription: Z\n---\n\nclean now\n")
    await writeAt(worktree.dir, "reference/w.md", "---\ndescription: W\n---\n\nclean\n")
    await rawCommit(worktree.dir, ["reference/z.md", "reference/w.md"], "clean up z and add w")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then: a --no-ff merge would carry commit 1 into main history, so the tip being clean is not enough
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/z.md (credential_assignment) @${first.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
    expect(await repo.head()).toBe(base)
  })

  it("#given a branch whose commits only delete a file #when validated #then it stays valid", async () => {
    // given
    const { worktree } = await fixture({ "reference/old.md": "---\ndescription: Old\n---\n\nold\n" })
    await rm(join(worktree.dir, "reference/old.md"))
    await rawCommit(worktree.dir, ["reference/old.md"], "remove old")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
  })

  it("#given a clean changed set #when validated #then it stays valid", async () => {
    // given
    const { worktree } = await fixture()
    await writeAt(worktree.dir, "reference/ok.md", "---\ndescription: Ok\n---\n\nordinary note\n")
    await rawCommit(worktree.dir, ["reference/ok.md"], "add ok")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
  })

  it("#given a merge commit whose resolution introduces a credential and a later commit removes it #when validated #then it fails naming the merge commit", async () => {
    // given
    const { repo, worktree } = await fixture({ "reference/m.md": "---\ndescription: M\n---\n\nbase\n" })
    const base = await repo.head()
    const exec = createNodeGitExec()
    const wt = worktree.dir
    const branch = worktree.branch
    await exec.run(["checkout", "-q", "-b", "memory/side-probe"], { cwd: wt, timeoutMs: 30_000 })
    await writeAt(wt, "reference/m.md", "---\ndescription: M\n---\n\nside change\n")
    await rawCommit(wt, ["reference/m.md"], "side change")
    await exec.run(["checkout", "-q", branch], { cwd: wt, timeoutMs: 30_000 })
    await writeAt(wt, "reference/m.md", "---\ndescription: M\n---\n\nmain change\n")
    await rawCommit(wt, ["reference/m.md"], "main change")
    await exec.run(["merge", "--no-ff", "-m", "merge side", "memory/side-probe"], { cwd: wt, timeoutMs: 30_000 }).catch(() => undefined)
    await writeAt(wt, "reference/m.md", "---\ndescription: M\n---\n\nresolved token=abc123456\n")
    const mergeSha = await rawCommit(wt, ["reference/m.md"], "merge side")
    await writeAt(wt, "reference/m.md", "---\ndescription: M\n---\n\nresolved clean\n")
    await rawCommit(wt, ["reference/m.md"], "clean resolution")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/m.md (credential_assignment) @${mergeSha.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
    expect(await repo.head()).toBe(base)
  })

  it("#given a merge commit with a clean resolution #when validated #then it stays valid", async () => {
    // given
    const { worktree } = await fixture({ "reference/m.md": "---\ndescription: M\n---\n\nbase\n" })
    const exec = createNodeGitExec()
    const wt = worktree.dir
    await exec.run(["checkout", "-q", "-b", "memory/side-clean"], { cwd: wt, timeoutMs: 30_000 })
    await writeAt(wt, "reference/side.md", "---\ndescription: Side\n---\n\nside\n")
    await rawCommit(wt, ["reference/side.md"], "side addition")
    await exec.run(["checkout", "-q", worktree.branch], { cwd: wt, timeoutMs: 30_000 })
    await writeAt(wt, "reference/main.md", "---\ndescription: Main\n---\n\nmain\n")
    await rawCommit(wt, ["reference/main.md"], "main addition")
    await exec.run(["merge", "--no-ff", "-m", "merge side clean", "memory/side-clean"], { cwd: wt, timeoutMs: 30_000 })

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
  })

  it("#given a non-markdown blob carrying a key in a deleted-then-restored history #when validated #then it fails naming the introducing commit", async () => {
    // given
    const { repo, worktree } = await fixture()
    const base = await repo.head()
    await writeAt(worktree.dir, "reference/data.json", `{"api_key": "sk-proj-AAAABBBBCCCCDDDD"}\n`)
    const first = await rawCommit(worktree.dir, ["reference/data.json"], "add data")
    await rm(join(worktree.dir, "reference/data.json"))
    await writeAt(worktree.dir, "reference/n.md", "---\ndescription: N\n---\n\nclean\n")
    await rawCommit(worktree.dir, ["reference/data.json", "reference/n.md"], "drop data and add n")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/data.json (openai_key) @${first.slice(0, 7)}`)
    expect(await repo.head()).toBe(base)
  })

  it("#given a zero-width-evaded credential inside a plain text blob #when validated #then it fails even though a regex-only hook cannot see it", async () => {
    // given
    const { worktree } = await fixture()
    await writeAt(worktree.dir, "reference/notes.txt", "x/token=\u200babc123456\n")
    const sha = await rawCommit(worktree.dir, ["reference/notes.txt"], "add notes")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/notes.txt (credential_assignment) @${sha.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
  })

  it("#given a branch restoring a blob that already exists in base history with a secret #when validated #then it still fails", async () => {
    // given: base once committed and then deleted a zero-width-evaded credential, so the blob is
    // reachable from the base; a plain rev-list --objects enumeration would skip it on restore.
    const evaded = "x/token=\u200babc123456\n"
    const { repo, worktree } = await fixture({ "reference/old.md": `---\ndescription: Old\n---\n\n${evaded}` })
    await rm(join(repo.dir, "reference/old.md"))
    await rawCommit(repo.dir, ["reference/old.md"], "delete old")
    const fresh = await createReflectionWorktree(repo, "run-2", join(repo.dir, "..", "worktrees-2"))
    await writeAt(fresh.dir, "reference/revived.md", `---\ndescription: Revived\n---\n\n${evaded}`)
    const sha = await rawCommit(fresh.dir, ["reference/revived.md"], "revive old content")

    // when
    const result = await validateCompletion(fresh, fresh.baseSha, fresh.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/revived.md (credential_assignment) @${sha.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
  })

  it("#given a tip adding a secret-like file name with a clean body #when validated #then it fails as a file-name hit without leaking the name", async () => {
    // given
    const { worktree } = await fixture()
    await writeAt(worktree.dir, "reference/token=abc123456.md", "---\ndescription: T\n---\n\nclean body\n")
    const sha = await rawCommit(worktree.dir, ["reference/token=abc123456.md"], "add named file")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/*** (credential_assignment, file name) @${sha.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
  })

  it("#given a secret-like name renamed away before the tip #when validated #then the introducing commit is still named", async () => {
    // given
    const { worktree } = await fixture()
    await writeAt(worktree.dir, `reference/${XOXB}.md`, "---\ndescription: T\n---\n\nclean body\n")
    const first = await rawCommit(worktree.dir, [`reference/${XOXB}.md`], "add badly named file")
    const exec = createNodeGitExec()
    await exec.run(["mv", `reference/${XOXB}.md`, "reference/clean.md"], { cwd: worktree.dir, timeoutMs: 30_000 })
    await rawCommit(worktree.dir, [`reference/${XOXB}.md`, "reference/clean.md"], "rename to clean")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/***.md (vendor_token, file name) @${first.slice(0, 7)}`)
    expect(detail).not.toContain(XOXB)
  })

  it("#given a type change to a symlink whose target is an evaded credential #when validated #then it fails naming the type-change commit", async () => {
    // given: the tracked file is replaced on disk by a symlink, so the commit is a T record and
    // the destination blob IS the symlink target string
    const { worktree } = await fixture({ "reference/link.txt": "clean\n" })
    await rm(join(worktree.dir, "reference/link.txt"))
    await symlink("x/token=\u200babc123456", join(worktree.dir, "reference/link.txt"))
    const first = await rawCommit(worktree.dir, ["reference/link.txt"], "swap to symlink")
    await rm(join(worktree.dir, "reference/link.txt"))
    await writeAt(worktree.dir, "reference/link.txt", "clean\n")
    await rawCommit(worktree.dir, ["reference/link.txt"], "restore regular file")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    const detail = await failureDetail(result)
    expect(detail).toBe(`secret_like_content: reference/link.txt (credential_assignment) @${first.slice(0, 7)}`)
    expect(detail).not.toContain("abc123456")
  })
})
