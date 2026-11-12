import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { buildIdentityPaths } from "./layout"
import { applyIdentityMerge } from "./merge"
import { AUTHOR, identity, lock, memoryRoot, note, removeMergeRoots } from "./merge.test-support"
import { readIdentityRecord } from "./record"

afterEach(removeMergeRoots)

describe("identity merge (#10070)", () => {
  it("#given a planned merge #when it is applied twice #then one commit carries the merge trailers, the target system/ is untouched, the source is marked mergedInto and the second apply is a no-op", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "system/persona.md": note("target persona"), "notes/diff.md": note("target") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      {
        "notes/new.md": note("new"),
        "notes/diff.md": note("source"),
        "system/persona.md": note("source persona"),
      },
      ["/work/project-feature"],
    )
    const sourceHead = await source.repo.head()

    const first = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    const second = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(first.status).toBe("merged")
    expect(second.status).toBe("already-merged")
    const commit = (await target.repo.log({ limit: 1 }))[0]
    expect(commit?.trailers["Omo-Merged-From"]).toBe("project-feature-bbbb2222")
    expect(commit?.trailers["Omo-Merged-Head"]).toBe(sourceHead ?? "")
    expect(await readFile(join(target.paths.repo, "system/persona.md"), "utf8")).toBe(note("target persona"))
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("new"))
    expect(
      await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/diff.md"), "utf8"),
    ).toBe(note("source"))
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({
      mergedInto: "project-aaaa1111",
      mergedHead: sourceHead,
    })
    expect(await source.repo.head()).toBe(sourceHead)
  }, 30_000)

  it("#given an aside copy the user edited and committed in the target #when the source changes that file and the merge reruns #then the edit is kept and the new copy goes to a fresh aside path (#12974 review r4)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/diff.md": note("source v1") }, [
      "/work/project-feature",
    ])
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    const aside = "reference/merged/project-feature-bbbb2222/notes/diff.md"
    await writeFile(join(target.paths.repo, aside), note("user edit"))
    await target.repo.commitWrite([aside], "edit aside", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/diff.md"), note("source v2"))
    await source.repo.commitWrite(["notes/diff.md"], "v2", AUTHOR)

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, aside), "utf8")).toBe(note("user edit"))
    const fresh = rerun.plan.actions.find((action) => action.path === "notes/diff.md")
    expect(fresh?.action).toBe("keep-aside")
    expect(fresh !== undefined && fresh.action !== "skip" ? fresh.destination : "").not.toBe(aside)
    expect(
      await readFile(
        join(target.paths.repo, fresh !== undefined && fresh.action !== "skip" ? fresh.destination : ""),
        "utf8",
      ),
    ).toBe(note("source v2"))
  }, 30_000)

  it("#given a source file that is not UTF-8 #when the merge applies #then it is refused before anything is written (#12974 review r5)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
      "/work/project-feature",
    ])
    await mkdir(join(source.paths.repo, "skills"), { recursive: true })
    await writeFile(
      join(source.paths.repo, "skills/icon.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]),
    )
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "skills/icon.png"], {
      cwd: source.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "icon"],
      { cwd: source.paths.repo, stdio: "ignore" },
    )
    const before = await target.repo.head()

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBeInstanceOf(Error)
    expect(String(outcome)).toContain("skills/icon.png")
    expect(await target.repo.head()).toBe(before)
    expect((await target.repo.status()).trim()).toBe("")
  }, 30_000)

  it("#given a merge that commits #when the write lock is released #then the source is already marked merged (#12974 review r6)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])
    let markedAtRelease: unknown
    const observingLock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => {
      const result = await operation()
      markedAtRelease = (await readIdentityRecord(source.paths.root))?.mergedInto
      return result
    }

    await applyIdentityMerge({ source: source.paths, target: target.paths, lock: observingLock, author: AUTHOR })

    expect(markedAtRelease).toBe("project-aaaa1111")
  }, 30_000)

  it("#given a target identity whose memory repository does not exist yet #when a store is merged into it #then the target repository is created and receives the files (#12974 review r7)", async () => {
    const root = await memoryRoot()
    const target = buildIdentityPaths(root, "project-aaaa1111")
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])

    const result = await applyIdentityMerge({
      source: source.paths,
      target,
      lock,
      author: AUTHOR,
      initTarget: (repo) => repo.init({ authorName: AUTHOR.authorName }),
    })

    expect(result.status).toBe("merged")
    expect(await readFile(join(target.repo, "notes/new.md"), "utf8")).toBe(note("new"))
  }, 30_000)

  it("#given another writer creates the same path between the plan and the lock #when the merge applies #then the target's file is kept and the source copy goes aside (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("from source") }, [
      "/work/project-feature",
    ])
    const racingLock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => {
      await writeFile(join(target.paths.repo, "notes/new.md"), note("written meanwhile"))
      await target.repo.commitWrite(["notes/new.md"], "concurrent write", AUTHOR)
      return operation()
    }

    const result = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock: racingLock,
      author: AUTHOR,
    })

    expect(result.status).toBe("merged")
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("written meanwhile"))
    expect(
      await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/new.md"), "utf8"),
    ).toBe(note("from source"))
  }, 30_000)

  it("#given a carried file the commit refuses #when the merge applies #then it fails and the target is left clean (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
      "/work/project-feature",
    ])
    await writeFile(join(source.paths.repo, "notes/key.md"), note("aws AKIAABCDEFGHIJKLMNOP"))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "notes/key.md"], {
      cwd: source.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "seed key"],
      { cwd: source.paths.repo, stdio: "ignore" },
    )
    expect((await source.repo.lsTree("HEAD")).includes("notes/key.md")).toBe(true)

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect((await target.repo.status()).trim()).toBe("")
    expect(outcome).toBeInstanceOf(Error)
  }, 30_000)

  it("#given a store merged once whose target later deleted a file #when the source gains a new note and the merge reruns #then only the new note arrives and the deleted file stays deleted (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "notes/old.md": note("old"), "notes/aside.md": note("source aside") },
      ["/work/project-feature"],
    )
    await writeFile(join(target.paths.repo, "notes/aside.md"), note("target aside"))
    await target.repo.commitWrite(["notes/aside.md"], "target aside", AUTHOR)
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    await rm(join(target.paths.repo, "notes/old.md"))
    await target.repo.commitWrite(["notes/old.md"], "drop old", AUTHOR)
    await writeFile(join(source.paths.repo, "notes/later.md"), note("later"))
    await source.repo.commitWrite(["notes/later.md"], "later", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("merged")
    expect(rerun.plan.actions.map((action) => action.path)).toEqual(["notes/later.md"])
    expect(await readFile(join(target.paths.repo, "notes/later.md"), "utf8")).toBe(note("later"))
    expect((await target.repo.lsTree("HEAD")).includes("notes/old.md")).toBe(false)
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)

  it("#given a merged store whose new commit only repeats content the target already has #when the merge reruns #then it reports nothing to merge and records the new head (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "notes/shared.md": note("shared"), "notes/diff.md": note("target diff") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "notes/one.md": note("one"), "notes/diff.md": note("source diff") },
      ["/work/project-feature"],
    )
    await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    await writeFile(join(source.paths.repo, "notes/shared.md"), note("shared"))
    await source.repo.commitWrite(["notes/shared.md"], "same as target", AUTHOR)
    const newHead = await source.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(rerun.status).toBe("nothing-to-merge")
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedHead: newHead })
  }, 30_000)
})
