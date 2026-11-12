import { describe, expect, it } from "bun:test"
import { memory, repoWith } from "../compile/compile.test-support"
import { applyMemoryCleanup } from "./apply"
import { author, lock, NOW, read } from "./cleanup.test-support"
import { planMemoryCleanup } from "./plan"

const OLD = { relativePath: "reference/old-LIFTED.md", content: memory("Old", "A hold that was lifted on the sixth.") }

describe("memory cleanup markdown links", () => {
  it("#given system/persona.md links an archived note with a markdown link #when planned #then the finding is held and apply leaves persona untouched", async () => {
    // given
    const persona = memory("Persona", "Who I am. The older rule: [old](../reference/old-LIFTED.md).")
    const { dir, repo } = await repoWith([OLD, { relativePath: "system/persona.md", content: persona }])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })
    const forced = await planMemoryCleanup(dir, { now: NOW, includeLoadBearing: true })
    const applied = await applyMemoryCleanup({ repo, lock, plan, author })

    // then
    expect(plan.findings).toStrictEqual([])
    expect(plan.held.map((finding) => finding.held)).toStrictEqual([
      "would repoint a link in system/persona.md (load-bearing; pass --include-load-bearing)",
    ])
    expect(forced.findings.map((finding) => finding.touches)).toStrictEqual([
      ["ARCHIVE.md", "reference/old-LIFTED.md", "system/persona.md"],
    ])
    expect(applied).toStrictEqual({ applied: false, reason: "nothing-to-do" })
    expect(await read(dir, "system/persona.md")).toBe(persona)
  })

  it("#given a read_only note links an archived note with a markdown link #when planned #then the finding is held as read_only", async () => {
    // given
    const { dir } = await repoWith([
      OLD,
      {
        relativePath: "reference/locked.md",
        content: `---\ndescription: Locked\nread_only: "true"\n---\nSee [the old hold](old-LIFTED.md).\n`,
      },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })

    // then
    expect(plan.findings).toStrictEqual([])
    expect(plan.held.map((finding) => finding.held)).toStrictEqual([
      "would repoint a link in reference/locked.md, which is read_only",
    ])
  })
})
