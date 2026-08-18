import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, createNodeGitExec } from "../git"
import { buildDefaultSeedFiles } from "../seeds"
import { applyFactsBatch, type FactsBatch } from "./extraction"
import { planFactsMutation } from "./mutation-plan"
import { applyFactsRecovery } from "./recovery"

const AUTHOR = { agentId: "facts-recovery", authorName: "Facts Recovery" }
const tempDirs: string[] = []

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "facts-recovery-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  return { dir, repo }
}

function batch(records = [
  { scope: "project" as const, text: "Uses Bun.", date: "2026-08-10" },
]): FactsBatch {
  return { batchId: "11111111-1111-4111-8111-111111111111", records }
}

async function blobExists(dir: string, oid: string): Promise<boolean> {
  return (await createNodeGitExec().run(["cat-file", "-e", oid], { cwd: dir, timeoutMs: 30_000 })).code === 0
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("facts path-state recovery ownership", () => {
  test("rejects a foreign edit injected immediately before initial pre-state capture", async () => {
    const { dir, repo } = await fixture()
    await applyFactsBatch(repo, batch(), AUTHOR)
    const next = {
      ...batch([{ scope: "project", text: "Uses TypeScript.", date: "2026-08-11" }]),
      batchId: "22222222-2222-4222-8222-222222222222",
    }
    const path = "notes/facts/2026-08.md"
    const originalCaptureAll = repo.pathState.captureAll.bind(repo.pathState)
    let injectedState: Awaited<ReturnType<typeof originalCaptureAll>> | undefined
    repo.pathState.captureAll = async (paths) => {
      repo.pathState.captureAll = originalCaptureAll
      await writeFile(join(dir, path), "---\ndescription: Foreign facts\n---\n\nforeign captured as pre\n")
      injectedState = await originalCaptureAll(paths)
      return injectedState
    }

    const result = await applyFactsBatch(repo, next, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    if (injectedState === undefined) throw new Error("capture injection did not run")
    const capturedInjection = injectedState.get(path)
    if (capturedInjection === undefined) throw new Error("injected path was not captured")
    expect(await repo.pathState.capture(path)).toEqual(capturedInjection)
    expect(await readFile(join(dir, path), "utf8")).toBe(
      "---\ndescription: Foreign facts\n---\n\nforeign captured as pre\n",
    )
    expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] === next.batchId)).toHaveLength(0)
  }, 30_000)

  test("rejects tracked worktree drift without changing index or worktree bytes", async () => {
    const { dir, repo } = await fixture()
    await applyFactsBatch(repo, batch(), AUTHOR)
    const next = batch([{ scope: "project", text: "Uses TypeScript.", date: "2026-08-11" }])
    const recovery = await planFactsMutation(repo, next, undefined)
    const path = recovery.paths[0]!.path
    await writeFile(join(dir, path), "foreign tracked bytes\n")
    const before = await repo.pathState.capture(path)

    expect((await applyFactsRecovery(repo, recovery, 1, AUTHOR)).outcome).toBe("parent_dirty")
    expect(await repo.pathState.capture(path)).toEqual(before)
    expect(await readFile(join(dir, path), "utf8")).toBe("foreign tracked bytes\n")
  }, 30_000)

  test("rejects tracked index drift without rewriting either surface", async () => {
    const { repo } = await fixture()
    await applyFactsBatch(repo, batch(), AUTHOR)
    const next = batch([{ scope: "project", text: "Uses TypeScript.", date: "2026-08-11" }])
    const recovery = await planFactsMutation(repo, next, undefined)
    const path = recovery.paths[0]!.path
    const foreignOid = await repo.pathState.hashIndexBlob(path, "foreign staged bytes\n", true)
    await repo.pathState.setIndex(path, { mode: "100644", oid: foreignOid })
    const before = await repo.pathState.capture(path)

    expect((await applyFactsRecovery(repo, recovery, 1, AUTHOR)).outcome).toBe("parent_dirty")
    expect(await repo.pathState.capture(path)).toEqual(before)
  }, 30_000)

  test("rejects foreign creation at a planned new path without deleting it", async () => {
    const { dir, repo } = await fixture()
    const recovery = await planFactsMutation(repo, batch(), undefined)
    const path = recovery.paths[0]!.path
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), "foreign created bytes\n", { flag: "wx" })
    const before = await repo.pathState.capture(path)

    expect((await applyFactsRecovery(repo, recovery, 1, AUTHOR)).outcome).toBe("parent_dirty")
    expect(await repo.pathState.capture(path)).toEqual(before)
  }, 30_000)

  test("rejects a foreign creation injected after bulk validation and before mutation", async () => {
    const { dir, repo } = await fixture()
    const recovery = await planFactsMutation(repo, batch([
      { scope: "project", text: "August.", date: "2026-08-10" },
      { scope: "project", text: "September.", date: "2026-09-01" },
    ]), undefined)
    const paths = recovery.paths.map((entry) => entry.path)
    const foreignPath = paths[0]!
    const originalCaptureAll = repo.pathState.captureAll.bind(repo.pathState)
    const indexBefore = new Map(paths.map((path) => [path, recovery.paths.find((entry) => entry.path === path)!.pre.index]))
    repo.pathState.captureAll = async (requested) => {
      repo.pathState.captureAll = originalCaptureAll
      const captured = await originalCaptureAll(requested)
      await mkdir(dirname(join(dir, foreignPath)), { recursive: true })
      await writeFile(join(dir, foreignPath), "foreign after validation\n")
      return captured
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    expect(await readFile(join(dir, foreignPath), "utf8")).toBe("foreign after validation\n")
    for (const path of paths) expect((await repo.pathState.capture(path)).index).toEqual(indexBefore.get(path) ?? null)
    for (const path of paths.slice(1)) expect(await repo.pathState.capture(path)).toEqual(
      recovery.paths.find((entry) => entry.path === path)!.pre,
    )
    expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] === recovery.batchId)).toHaveLength(0)
  }, 30_000)

  test("preserves every path when one member of a multi-path batch is foreign", async () => {
    const { dir, repo } = await fixture()
    const recovery = await planFactsMutation(repo, batch([
      { scope: "project", text: "August.", date: "2026-08-10" },
      { scope: "project", text: "September.", date: "2026-09-01" },
    ]), undefined)
    const foreign = recovery.paths[1]!.path
    await mkdir(dirname(join(dir, foreign)), { recursive: true })
    await writeFile(join(dir, foreign), "foreign\n")
    const before = await repo.pathState.captureAll(recovery.paths.map((entry) => entry.path))

    expect((await applyFactsRecovery(repo, recovery, 2, AUTHOR)).outcome).toBe("parent_dirty")
    expect(await repo.pathState.captureAll([...before.keys()])).toEqual(before)
  }, 30_000)

  test("restores owned partial pre/post residue and commits the exact recorded post state", async () => {
    const { repo } = await fixture()
    const recovery = await planFactsMutation(repo, batch([
      { scope: "project", text: "August.", date: "2026-08-10" },
      { scope: "project", text: "September.", date: "2026-09-01" },
    ]), undefined)
    const first = recovery.paths[0]!
    await repo.pathState.setIndex(first.path, first.post.index)
    await repo.pathState.writeWorktree(first.path, first.post.worktree)

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("committed")
    for (const entry of recovery.paths) {
      expect(await repo.pathState.capture(entry.path)).toEqual(entry.post)
    }
    expect((await repo.log({ limit: 1 }))[0]?.trailers["Omo-Facts-Batch"]).toBe(recovery.batchId)
  }, 30_000)

  test("durably inserts every pre and post identity before envelope publication", async () => {
    const { dir, repo } = await fixture()
    await repo.configSet("filter.factsqa.clean", "sed 's/^WT:/IDX:/'")
    await repo.configSet("filter.factsqa.smudge", "sed 's/^IDX:/WT:/'")
    await mkdir(join(dir, "notes", "facts"), { recursive: true })
    await writeFile(join(dir, ".gitattributes"), "notes/facts/*.md filter=factsqa\n")
    await writeFile(
      join(dir, "notes", "facts", "2026-08.md"),
      "---\ndescription: Explicit facts for 2026-08\n---\n\nWT: base\n",
    )
    await repo.commitWrite([".gitattributes", "notes/facts/2026-08.md"], "seed filtered facts", AUTHOR)
    const result = await applyFactsBatch(repo, batch(), AUTHOR, {
      publishRecovery: async (recovery) => {
        const oids = recovery.paths.flatMap((entry) => [
          ...(entry.pre.index === null ? [] : [entry.pre.index.oid]),
          ...(entry.pre.worktree.kind === "missing" ? [] : [entry.pre.worktree.oid]),
          entry.post.index.oid,
          entry.post.worktree.oid,
        ])
        expect(recovery.paths[0]?.pre.index?.oid).not.toBe(
          recovery.paths[0]?.pre.worktree.kind === "file" ? recovery.paths[0].pre.worktree.oid : undefined,
        )
        for (const oid of oids) expect(await blobExists(dir, oid)).toBe(true)
      },
    })

    expect(result.outcome).toBe("committed")
  }, 30_000)

  test("publishes a complete blob-backed envelope before the first affected-path mutation", async () => {
    const { dir, repo } = await fixture()
    let published = false
    const result = await applyFactsBatch(repo, batch(), AUTHOR, {
      publishRecovery: async (recovery) => {
        published = true
        expect(recovery.paths.map((entry) => entry.path)).toEqual([...recovery.paths].map((entry) => entry.path).sort())
        for (const entry of recovery.paths) {
          expect(await repo.pathState.capture(entry.path)).toEqual(entry.pre)
          expect(await blobExists(dir, entry.post.index.oid)).toBe(true)
          expect(await blobExists(dir, entry.post.worktree.oid)).toBe(true)
        }
      },
    })

    expect(published).toBe(true)
    expect(result.outcome).toBe("committed")
  }, 30_000)
})
