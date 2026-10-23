import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createNodeGitExec, GitMemoryRepo, type GitExec } from "./index"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []
const git = createNodeGitExec()
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTree(dir, { maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

function countingExec(): { readonly exec: GitExec; readonly calls: () => number } {
  let calls = 0
  return {
    exec: {
      run(argv, options) {
        calls += 1
        return git.run(argv, options)
      },
    },
    calls: () => calls,
  }
}

async function run(dir: string, argv: readonly string[]): Promise<string> {
  const result = await git.run(argv, { cwd: dir, timeoutMs: 30_000, env })
  if (result.code !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`)
  return result.stdout
}

async function commitFiles(dir: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await run(dir, ["add", "-A"])
  await run(dir, ["commit", "-q", "-m", message])
}

async function repoWithRootSpacedRenameAndMerge(exec: GitExec): Promise<{ readonly dir: string; readonly repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-log-paths-")))
  tempDirs.push(dir)
  await run(dir, ["init", "-q", "-b", "main"])
  await commitFiles(dir, { "system/persona.md": "p\n" }, "root")
  for (let index = 0; index < 8; index += 1) {
    await commitFiles(dir, { [`reference/note ${index}.md`]: `${index}\n` }, `note ${index}\n\nOmo-Session: s${index % 2}`)
  }
  await run(dir, ["checkout", "-q", "-b", "side"])
  await commitFiles(dir, { "reference/side.md": "side\n", "system/persona.md": "side\n" }, "side edit")
  await run(dir, ["checkout", "-q", "main"])
  await run(dir, ["mv", "reference/note 0.md", "reference/renamed.md"])
  await run(dir, ["commit", "-q", "-m", "rename"])
  await run(dir, ["merge", "-q", "--no-ff", "--no-edit", "side"])
  return { dir, repo: new GitMemoryRepo({ dir, agentId: "agent", exec }) }
}

// A commit carrying an SSH signature header, written without any signing tool: git reports a signature
// for it under `log.showSignature` whatever the verifier says, which is all these tests need.
async function commitSigned(dir: string, files: Record<string, string>, message: string, at: number): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await run(dir, ["add", "-A"])
  const tree = (await run(dir, ["write-tree"])).trim()
  const parent = (await run(dir, ["rev-parse", "HEAD"])).trim()
  const object = [
    `tree ${tree}`, `parent ${parent}`, `author t <t@t> ${at} +0000`, `committer t <t@t> ${at} +0000`,
    "gpgsig -----BEGIN SSH SIGNATURE-----", " U1NIU0lH", " -----END SSH SIGNATURE-----", "", message, "",
  ].join("\n")
  const objectPath = join(dir, ".git", "signed-commit")
  await writeFile(objectPath, object)
  const sha = (await run(dir, ["hash-object", "-t", "commit", "-w", objectPath])).trim()
  await run(dir, ["update-ref", "HEAD", sha])
}

async function diffTreePaths(dir: string, sha: string): Promise<string[]> {
  return (await run(dir, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", sha])).split("\0").filter(Boolean)
}

describe("GitMemoryRepo.log includePaths", () => {
  it("#given a range of many commits #when log reads it with paths #then one git process answers and every commit's paths match diff-tree", async () => {
    // given
    const counting = countingExec()
    const { dir, repo } = await repoWithRootSpacedRenameAndMerge(counting.exec)
    const expected = await Promise.all(
      (await run(dir, ["rev-list", "HEAD"])).trim().split("\n").map(async (sha): Promise<[string, string[]]> => [sha, await diffTreePaths(dir, sha)]),
    )
    const before = counting.calls()

    // when
    const commits = await repo.log({ range: "HEAD", includePaths: true })

    // then
    expect(counting.calls() - before).toBe(1)
    expect(commits.map((commit) => [commit.sha, commit.paths])).toEqual(expected)
    expect(commits.find((commit) => commit.subject === "note 3")?.trailers).toEqual({ "Omo-Session": "s1" })
    expect(commits.find((commit) => commit.subject === "rename")?.paths).toEqual(["reference/note 0.md", "reference/renamed.md"])
  })

  it("#given a pathspec-filtered log #when it reads paths #then each selected commit lists all of its paths like diff-tree", async () => {
    // given
    const { dir, repo } = await repoWithRootSpacedRenameAndMerge(countingExec().exec)

    // when
    const commits = await repo.log({ paths: ["reference/side.md"], includePaths: true })

    // then
    expect(commits.map((commit) => commit.subject)).toEqual(["side edit"])
    expect(commits[0]?.paths).toEqual(await diffTreePaths(dir, commits[0]?.sha ?? ""))
    expect(commits[0]?.paths).toEqual(["reference/side.md", "system/persona.md"])
  })
})

// Contract: the user's git config never changes what a memory log read returns (#10726 review).
describe("GitMemoryRepo log reads under user git config", () => {
  it("#given log.follow=true in the git config #when a single-path log reads paths #then it returns the commits like diff-tree", async () => {
    // given
    const { dir, repo } = await repoWithRootSpacedRenameAndMerge(countingExec().exec)
    await run(dir, ["config", "log.follow", "true"])

    // when
    const commits = await repo.log({ paths: ["reference/side.md"], includePaths: true })

    // then
    expect(commits.map((commit) => commit.subject)).toEqual(["side edit"])
    expect(commits[0]?.paths).toEqual(await diffTreePaths(dir, commits[0]?.sha ?? ""))
  })

  it("#given log.showSignature=true and signed commits #when log, log with paths and the HEAD time are read #then each answer equals the one without the setting", async () => {
    // given
    const { dir, repo } = await repoWithRootSpacedRenameAndMerge(countingExec().exec)
    await commitSigned(dir, { "reference/signed.md": "s\n" }, "signed one", 1_700_000_000)
    await commitSigned(dir, { "reference/signed.md": "t\n" }, "signed two", 1_700_000_100)
    const head = (await run(dir, ["rev-parse", "HEAD"])).trim()
    const read = async (reader: GitMemoryRepo) => ({
      log: await reader.log({ limit: 5 }),
      paths: await reader.log({ limit: 5, includePaths: true }),
      head: await reader.headCommitTimestamp(),
      times: Object.fromEntries(await reader.pathCommitTimes(head)),
    })
    const plain = await read(repo)
    await run(dir, ["config", "log.showSignature", "true"])
    await rm(join(dir, ".git", "omo-path-commit-times.json"), { force: true })

    // when
    const configured = await read(new GitMemoryRepo({ dir, agentId: "agent", exec: countingExec().exec }))

    // then
    expect(plain.head).toBe(1_700_000_100)
    expect(plain.times["reference/signed.md"]).toBe(1_700_000_100)
    expect(plain.log.slice(0, 2).map((commit) => commit.subject)).toEqual(["signed two", "signed one"])
    expect(configured).toEqual(plain)
  })
})
