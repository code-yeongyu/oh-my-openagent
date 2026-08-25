import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { parseMemoryFile } from "@oh-my-opencode/memory-core"

import { createMemoryTools } from "./tools"
import { boundFixture, git, seedFile, textOf } from "./tools.test-support"

// Each case initializes a real Git repo and commits through git children. Match the 60s process test
// ceiling used by the supervisor suites: this file timed out on Windows CI at the 5s default while
// absorbing the preceding file's process cleanup, not because its own work grew.
setDefaultTimeout(60_000)

describe("memory tool execution", () => {
  test("#given a bound identity #when memory_apply_patch executes #then the patch is applied and committed", async () => {
    // given
    const fixture = await boundFixture()
    await seedFile(fixture, "system/human/prefs/coding.md", "Use broad abstractions")
    const [, applyPatchTool] = createMemoryTools(() => fixture.context)
    const input = [
      "*** Begin Patch",
      "*** Update File: system/human/prefs/coding.md",
      "@@",
      "-Use broad abstractions",
      "+Prefer small focused helpers",
      "*** End Patch",
    ].join("\n")

    // when
    const result = await applyPatchTool.execute("call-1", { reason: "Refine coding preferences", input })

    // then
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/^memory_apply_patch committed locally \([0-9a-f]{7}\)\.$/)
    const written = parseMemoryFile(await readFile(join(fixture.repo.dir, "system/human/prefs/coding.md"), "utf8"))
    expect(written.body).toContain("Prefer small focused helpers")
    expect(await git(fixture.repo, ["log", "-1", "--format=%s"])).toBe("Refine coding preferences")
  })
  test("#given a bound identity #when memory_apply_patch receives a malformed patch #then the parse error maps to an error result", async () => {
    // given
    const fixture = await boundFixture()
    const [, applyPatchTool] = createMemoryTools(() => fixture.context)

    // when
    const result = await applyPatchTool.execute("call-1", { reason: "Broken", input: "definitely not a patch" })

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("memory_apply_patch:")
  })
})

describe("memory tool onCommit seam", () => {
  test("#given a bound identity #when memory_apply_patch commits #then onCommit receives the commit metadata", async () => {
    // given
    const fixture = await boundFixture()
    await seedFile(fixture, "system/identity.md", "- Name: Ada")
    const commits: Array<{ sha: string; subject: string; affectedPaths: readonly string[] }> = []
    const [, applyPatchTool] = createMemoryTools(() => fixture.context, {
      onCommit: (commit) => commits.push(commit),
    })
    const input = [
      "*** Begin Patch",
      "*** Update File: system/identity.md",
      "@@",
      "-- Name: Ada",
      "+- Name: Grace",
      "*** End Patch",
    ].join("\n")

    // when
    const result = await applyPatchTool.execute("call-2", { reason: "rename", input })

    // then
    expect(result.isError).toBeUndefined()
    expect(commits).toHaveLength(1)
    expect(commits[0]?.subject).toBe("rename")
    expect(commits[0]?.affectedPaths).toEqual(["system/identity.md"])
  })
})
