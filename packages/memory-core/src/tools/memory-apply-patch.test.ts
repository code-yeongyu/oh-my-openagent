import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"

import {
  author,
  createPatchFixtureHarness,
  git,
  memoryApplyPatch,
  params,
} from "./memory-apply-patch.test-support"

// Each case drives a real git repository through commit and patch application; the 5s default is not
// a budget those subprocesses fit on a loaded Windows runner.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)
const { fixture, cleanup } = createPatchFixtureHarness()

afterEach(cleanup)

describe("memoryApplyPatch success operations", () => {
  it("#given an add without frontmatter #when applied #then description is synthesized and reason and author commit", async () => {
    // #given
    const { dir, repo, locksDirectory } = await fixture()
    const reason = "remember a contact"
    const input = [
      "*** Begin Patch",
      "*** Add File: system/contact.md",
      "+Sarah: cofounder",
      "*** End Patch",
    ].join("\n")

    // #when
    const result = await memoryApplyPatch(repo, params(locksDirectory, reason, input))

    // #then
    expect(result.message).toMatch(/^memory_apply_patch committed locally \([a-f0-9]{7}\)\.$/)
    expect(await repo.show("HEAD", "system/contact.md")).toBe(
      "---\ndescription: Memory block system/contact\n---\nSarah: cofounder",
    )
    expect(await git(dir, ["log", "-1", "--pretty=format:%s%n%an%n%ae"])).toBe(
      `${reason}\n${author.authorName}\n${author.authorEmail}`,
    )
  })

  it("#given add then update in one patch #when applied #then the update sees the pending add", async () => {
    // #given
    const { repo, locksDirectory } = await fixture()
    const input = [
      "*** Begin Patch",
      "*** Add File: system/facts.md",
      "+old fact",
      "*** Update File: system/facts.md",
      "@@",
      "-old fact",
      "+new fact",
      "*** End Patch",
    ].join("\n")

    // #when
    await memoryApplyPatch(repo, params(locksDirectory, "add and refine", input))

    // #then
    expect(await repo.show("HEAD", "system/facts.md")).toContain("new fact")
  })

  it("#given a move followed by an edit #when applied #then target writes are visible and source is deleted", async () => {
    // #given
    const memory = "---\ndescription: Notes\n---\nold"
    const { repo, locksDirectory } = await fixture({ "system/source.md": memory })
    const input = [
      "*** Begin Patch",
      "*** Update File: system/source.md",
      "*** Move to: system/target.md",
      "@@",
      "-old",
      "+middle",
      "*** Update File: system/target.md",
      "@@",
      "-middle",
      "+final",
      "*** End Patch",
    ].join("\n")

    // #when
    await memoryApplyPatch(repo, params(locksDirectory, "move and edit", input))

    // #then
    expect(await repo.lsTree()).toEqual(["system/target.md"])
    expect(await repo.show("HEAD", "system/target.md")).toContain("final")
  })

  it("#given a final line without newline #when a newline-anchored hunk applies #then the sole fallback preserves no newline", async () => {
    // #given
    const { repo, locksDirectory } = await fixture({
      "system/tail.md": "---\ndescription: Tail\n---\ntail",
    })
    const input = "*** Begin Patch\n*** Update File: system/tail.md\n@@\n-tail\n+changed\n*** End Patch"

    // #when
    await memoryApplyPatch(repo, params(locksDirectory, "change tail", input))

    // #then
    expect(await repo.show("HEAD", "system/tail.md")).toBe("---\ndescription: Tail\n---\nchanged")
  })
})
