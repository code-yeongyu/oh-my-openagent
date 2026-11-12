import { afterEach, describe, expect, it } from "bun:test"
import { planIdentityMerge } from "./merge"
import { commitTreePath, identity, memoryRoot, note, removeMergeRoots } from "./merge.test-support"

afterEach(removeMergeRoots)

describe("identity merge (#10070)", () => {
  it("#given a predecessor with new, identical, differing and system files #when the merge is planned #then nothing is written and each file gets its action", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "notes/same.md": note("same"), "notes/diff.md": note("target") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      {
        "notes/new.md": note("new"),
        "notes/same.md": note("same"),
        "notes/diff.md": note("source"),
        "system/persona.md": note("persona"),
      },
      ["/work/project-feature"],
    )
    const headBefore = await target.repo.head()

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "notes/diff.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/notes/diff.md",
      },
      { path: "notes/new.md", action: "add", destination: "notes/new.md" },
      { path: "notes/same.md", action: "skip" },
      {
        path: "system/persona.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/system/persona.md",
      },
    ])
    expect(await target.repo.head()).toBe(headBefore)
  }, 30_000)

  it("#given a source file whose path differs from a target file only in letter case #when the merge is planned #then it goes aside instead of overwriting the target on a case-insensitive disk (#12974 review)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/Habit.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/habit.md": note("source") }, [
      "/work/project-feature",
    ])

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "notes/habit.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/notes/habit.md",
      },
    ])
  }, 30_000)

  it("#given a source path whose first segment is System/ #when the merge is planned #then it goes aside like system/ (#12974 review r6)", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "system/persona.md": note("persona") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "System/x.md": note("x") }, [
      "/work/project-feature",
    ])

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      {
        path: "System/x.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/System/x.md",
      },
    ])
  }, 30_000)

  it.each(["system./new.md", "system /new.md", "system:s/new.md", "sys\u200ctem/new.md", "\u017fystem/new.md"])(
    "#given a source tree entry %j whose first name a disk reads as system #when the merge is planned #then it goes aside like system/ (#12974 review LOW)",
    async (path) => {
      const root = await memoryRoot()
      const target = await identity(root, "project-aaaa1111", { "system/persona.md": note("persona") }, [
        "/work/project",
      ])
      const source = await identity(root, "project-feature-bbbb2222", { "notes/base.md": note("base") }, [
        "/work/project-feature",
      ])
      commitTreePath(source.paths.repo, path, note("carried"))

      const plan = await planIdentityMerge(source.paths, target.paths)

      expect(plan.actions.find((action) => action.path === path)).toEqual({
        path,
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/" + path,
      })
    },
    30_000,
  )
})
