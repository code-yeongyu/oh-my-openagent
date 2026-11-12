import { describe, expect, it } from "bun:test"
import { auditMemoryRepo } from "../audit/audit"
import { memory, repoWith } from "../compile/compile.test-support"
import { exists, LESSON, read, run } from "./cleanup.test-support"

const C_FACT = "Measured on the third host: its queue drains in four minutes once the grant lands."

describe("memory cleanup duplicate chains", () => {
  it("#given b is the canonical for c and also a near-duplicate of a #when applied #then b is kept, c merges into it, and no link dangles", async () => {
    // given
    const { dir, repo } = await repoWith([
      {
        relativePath: "reference/a.md",
        content: memory(
          "A",
          `${LESSON}\n\nMeasured on the first host: a 48-line queue at load 16.\n\nMeasured on the second host: nine lines at load 4.`,
        ),
      },
      { relativePath: "reference/b.md", content: memory("B", LESSON) },
      { relativePath: "reference/c.md", content: memory("C", `${LESSON}\n\n${C_FACT}`) },
      {
        relativePath: "reference/project/one.md",
        content: memory("One", "Read [[reference/a]], [[reference/b]] and [[reference/c]] before placing."),
      },
      {
        relativePath: "reference/project/two.md",
        content: memory("Two", "Placement follows [[reference/a]] and [[reference/b]] on every host."),
      },
      { relativePath: "reference/project/three.md", content: memory("Three", "Grants follow [[reference/a]] only.") },
    ])

    // when
    const { plan, applied } = await run(repo, { similarity: 0.8 })

    // then
    expect(
      plan.findings.map((finding) => [finding.subject, finding.related, finding.actions.map((action) => action.kind)]),
    ).toStrictEqual([["reference/c.md", "reference/b.md", ["merge", "archive"]]])
    expect(applied.applied).toBe(true)
    expect(await exists(dir, "reference/b.md")).toBe(true)
    expect(await read(dir, "reference/b.md")).toContain(C_FACT)
    expect(await read(dir, "reference/project/one.md")).toContain("[[reference/b]] and [[reference/b]]")
    expect((await auditMemoryRepo(dir)).counts.link_dangling).toBe(0)
  })
})
