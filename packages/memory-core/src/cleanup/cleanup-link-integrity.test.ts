import { describe, expect, it } from "bun:test"
import { auditMemoryRepo } from "../audit/audit"
import { memory, repoWith } from "../compile/compile.test-support"
import { NOW, read, run } from "./cleanup.test-support"
import { planMemoryCleanup } from "./plan"

const OLD = {
  relativePath: "reference/old-LIFTED.md",
  content: memory("Old", "The hold was lifted; [the sibling rule](sibling.md) replaced it."),
}
const SIBLING = { relativePath: "reference/sibling.md", content: memory("Sibling", "The rule for every placement.") }

async function danglingLinks(dir: string): Promise<string[][]> {
  const report = await auditMemoryRepo(dir)
  return report.issues.filter((issue) => issue.code === "link_dangling").map((issue) => [issue.path, issue.detail])
}

describe("memory cleanup link integrity", () => {
  it("#given an archived note with a relative link and linkers outside the corpus #when applied #then no link dangles", async () => {
    // given
    const { dir, repo } = await repoWith([
      OLD,
      SIBLING,
      {
        relativePath: "notes/log.md",
        content: "Read [[reference/old-LIFTED]] and [it](../reference/old-LIFTED.md).\n",
      },
      { relativePath: "memory/reference/legacy.md", content: memory("Legacy", "Legacy: [[reference/old-LIFTED]].") },
      { relativePath: "README.md", content: "Start at [the old hold](reference/old-LIFTED.md).\n" },
    ])
    const before = await danglingLinks(dir)

    // when
    const { plan, applied } = await run(repo)

    // then
    expect(before).toStrictEqual([])
    expect(applied.applied).toBe(true)
    expect(await danglingLinks(dir)).toStrictEqual([])
    expect(plan.findings.map((finding) => finding.touches)).toStrictEqual([
      ["ARCHIVE.md", "README.md", "memory/reference/legacy.md", "notes/log.md", "reference/old-LIFTED.md"],
    ])
    expect(await read(dir, "ARCHIVE.md")).toContain("[the sibling rule](reference/sibling.md)")
    expect(await read(dir, "notes/log.md")).toBe(
      "Read [[ARCHIVE.md|reference/old-LIFTED (archived)]] and [it](../ARCHIVE.md).\n",
    )
  })

  it("#given a legacy memory/system/persona.md links an archived note #when planned #then the finding is held as load-bearing", async () => {
    // given
    const { dir } = await repoWith([
      OLD,
      SIBLING,
      { relativePath: "memory/system/persona.md", content: memory("Persona", "See [[reference/old-LIFTED]].") },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })

    // then
    expect(plan.findings).toStrictEqual([])
    expect(plan.held.map((finding) => finding.held)).toStrictEqual([
      "would repoint a link in memory/system/persona.md (load-bearing; pass --include-load-bearing)",
    ])
  })

  it("#given a note cleanup skipped as unparsable links an archived note #when planned #then the finding is held, since a skipped file is never touched", async () => {
    // given
    const { dir } = await repoWith([
      OLD,
      SIBLING,
      {
        relativePath: "reference/broken.md",
        content: "---\ntitle: no description\n---\nSee [[reference/old-LIFTED]].\n",
      },
    ])

    // when
    const plan = await planMemoryCleanup(dir, { now: NOW })

    // then
    expect(plan.scanned.skipped.map((file) => file.path)).toStrictEqual(["reference/broken.md"])
    expect(plan.findings).toStrictEqual([])
    expect(plan.held.map((finding) => finding.held.split(",")[0])).toStrictEqual([
      "would repoint a link in reference/broken.md",
    ])
  })

  it.each(["memory/reference/broken.md", "notes/broken.md"])(
    "#given %s outside the candidates has a header that does not parse but says read_only #when planned and applied #then the finding is held and the file is never rewritten",
    async (path) => {
      // given
      const content = '---\nread_only: "true"\n---\nSee [[reference/old-LIFTED]].\n'
      const { dir, repo } = await repoWith([OLD, SIBLING, { relativePath: path, content }])

      // when
      const { plan, applied } = await run(repo)

      // then
      expect(await read(dir, path)).toBe(content)
      expect(applied).toStrictEqual({ applied: false, reason: "nothing-to-do" })
      expect(plan.scanned.skipped).toStrictEqual([
        { path, reason: "frontmatter: target file frontmatter is missing 'description'" },
      ])
      expect(plan.findings).toStrictEqual([])
      expect(plan.held.map((finding) => finding.held.split(",")[0])).toStrictEqual([`would repoint a link in ${path}`])
    },
  )

  it("#given an archived note whose relative links point at its parent folder #when applied #then they become '.' at the root, never an empty destination", async () => {
    // given
    const { dir, repo } = await repoWith([
      {
        relativePath: "reference/up-LIFTED.md",
        content: memory("Up", "The hold was lifted; go [up](..) or [up](../)."),
      },
      SIBLING,
    ])
    const before = await danglingLinks(dir)

    // when
    const { applied } = await run(repo)

    // then
    const archive = await read(dir, "ARCHIVE.md")
    expect([...archive.matchAll(/\[up\]\(([^)]*)\)/g)].map((found) => found[1])).toStrictEqual([".", "."])
    expect(applied.applied).toBe(true)
    // The audit never resolves a link to the root folder, so the same two links stay counted, now from the archive.
    expect(before).toStrictEqual([
      ["reference/up-LIFTED.md", ".."],
      ["reference/up-LIFTED.md", "../"],
    ])
    expect(await danglingLinks(dir)).toStrictEqual([
      ["ARCHIVE.md", "."],
      ["ARCHIVE.md", "."],
    ])
  })

  it("#given an archived note in a subfolder whose relative link already dangled and a root file of that name #when applied #then the archived link keeps its old folder and gains no target", async () => {
    // given
    const { dir, repo } = await repoWith([
      {
        relativePath: "reference/deep/old-LIFTED.md",
        content: memory("Old deep", "The hold was lifted; [gone](missing.md) was never written."),
      },
      { relativePath: "missing.md", content: "A root file that happens to share the name.\n" },
    ])
    const before = await danglingLinks(dir)

    // when
    const { applied } = await run(repo)

    // then
    const archive = await read(dir, "ARCHIVE.md")
    expect([...archive.matchAll(/\[gone\]\(([^)]*)\)/g)].map((found) => found[1])).toStrictEqual([
      "reference/deep/missing.md",
    ])
    expect(applied.applied).toBe(true)
    expect(before).toStrictEqual([["reference/deep/old-LIFTED.md", "missing.md"]])
    expect(await danglingLinks(dir)).toStrictEqual([["ARCHIVE.md", "reference/deep/missing.md"]])
  })
})
