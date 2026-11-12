import { describe, expect, it } from "bun:test"
import { memory, repoWith } from "../compile/compile.test-support"
import { LESSON, NOW } from "./cleanup.test-support"
import { planMemoryCleanup } from "./plan"
import { renderMemoryCleanupReport } from "./report"

describe("memory cleanup legacy layout", () => {
  it("#given a repository in the legacy memory/ layout #when planned #then the report says those notes were not scanned instead of calling it clean", async () => {
    // given
    const { dir } = await repoWith([
      { relativePath: "memory/reference/a.md", content: memory("A", LESSON) },
      { relativePath: "memory/reference/b.md", content: memory("B", LESSON) },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })
    const text = renderMemoryCleanupReport(plan)

    // then
    expect(text).not.toContain("already clean")
    expect(text).toContain("not scanned: 2 note(s) in the legacy memory/ layout")
    expect(text).toContain("nothing in the scanned notes; 2 note(s) in the legacy memory/ layout were not scanned")
    expect(plan.scanned.legacy).toBe(2)
  })
})
