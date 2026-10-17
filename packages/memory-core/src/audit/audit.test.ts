import { expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { memory, repoWith } from "../compile/compile.test-support"
import { auditMemoryRepo } from "./audit"

test("#given clean memory #when audited #then no structural defects", async () => {
  const { dir } = await repoWith([
    { relativePath: "reference/a.md", content: memory("A", "Unique reference") },
    { relativePath: "system/human.md", content: memory("Human", "Unique human") },
    { relativePath: "ARCHIVE.md", content: "Old archive" },
    { relativePath: "README.md", content: "Readme" },
    { relativePath: "notes/n.md", content: "Note" },
  ])
  const report = await auditMemoryRepo(dir)
  expect(report.issues).toEqual([])
  expect(Object.values(report.counts).every((count) => count === 0)).toBe(true)
})

test("#given root wikilinks and relative markdown links #when audited #then only missing targets reported", async () => {
  const { dir } = await repoWith([
    { relativePath: "reference/a.md", content: memory("A", "[[reference/missing.md]] [[notes/gone]] [see](../people/nobody/card.md) [[exists.md]] [peer](exists.md#h)") },
    { relativePath: "reference/exists.md", content: memory("Exists", "Target") },
    { relativePath: "notes/n.md", content: "[[reference/exists.md]] [[reference/exists|label]] [[reference/exists#h]]" },
  ])
  const issues = (await auditMemoryRepo(dir)).issues.filter((issue) => issue.code === "link_dangling")
  expect(issues.map((issue) => issue.detail).sort()).toEqual([
    "reference/missing.md", "notes/gone", "../people/nobody/card.md", "exists.md",
  ].sort())
  expect(issues.every((issue) => issue.path === "reference/a.md")).toBe(true)
})

test("#given fenced examples and external links #when audited #then examples are not dangling", async () => {
  const { dir } = await repoWith([{ relativePath: "reference/a.md", content: memory("A", "```md\n[[missing]]\n```\n~~~\n[x](missing.md)\n~~~\n[x](https://example.com) [mail](mailto:x@example.com)") }])
  expect((await auditMemoryRepo(dir)).counts.link_dangling).toBe(0)
})

test("#given same bodies with different headers #when audited #then later path names duplicate group", async () => {
  const { dir } = await repoWith([
    { relativePath: "reference/a.md", content: memory("First", "Same body") },
    { relativePath: "reference/b.md", content: memory("Second", "Same body") },
  ])
  const issues = (await auditMemoryRepo(dir)).issues.filter((issue) => issue.code === "content_duplicate")
  expect(issues).toHaveLength(1)
  expect(issues[0]?.path).toBe("reference/b.md")
  expect(issues[0]?.related).toEqual(["reference/a.md", "reference/b.md"])
})

test("#given outside-home note #when audited #then orphan is named", async () => {
  const { dir } = await repoWith([{ relativePath: "scratch/x.md", content: "Stray" }])
  const report = await auditMemoryRepo(dir)
  expect(report.issues).toEqual([{ code: "path_orphan", path: "scratch/x.md", detail: "outside memory homes" }])
})

test("#given missing description #when audited #then frontmatter violation is reported", async () => {
  const { dir } = await repoWith([])
  await mkdir(join(dir, "reference"), { recursive: true })
  await writeFile(join(dir, "reference/b.md"), "---\nkind: note\n---\nBody")
  expect((await auditMemoryRepo(dir)).issues).toEqual([
    { code: "frontmatter_invalid", path: "reference/b.md", detail: "missing required field 'description'" },
  ])
})

test("#given invalid UTF8 #when audited #then unreadable file is reported without parsing", async () => {
  const { dir } = await repoWith([])
  await mkdir(join(dir, "reference"), { recursive: true })
  await writeFile(join(dir, "reference/b.md"), new Uint8Array([0xff, 0xfe]))
  const report = await auditMemoryRepo(dir)
  expect(report.counts.file_unreadable).toBe(1)
  expect(report.counts.frontmatter_invalid).toBe(0)
})

test("#given pressure threshold #when audited #then caller budget controls warning", async () => {
  const { dir } = await repoWith([])
  expect((await auditMemoryRepo(dir, { systemTokens: { totalTokens: 800 }, budgetTokens: 1000 })).counts.system_pressure).toBe(1)
  expect((await auditMemoryRepo(dir, { systemTokens: { totalTokens: 799 }, budgetTokens: 1000 })).counts.system_pressure).toBe(0)
  expect((await auditMemoryRepo(dir)).counts.system_pressure).toBe(0)
})

test("#given unchanged corpus #when audited twice #then findings and counts are identical", async () => {
  const { dir } = await repoWith([{ relativePath: "reference/a.md", content: memory("A", "[[missing]]") }])
  const first = await auditMemoryRepo(dir)
  const second = await auditMemoryRepo(dir)
  expect(second.issues).toEqual(first.issues)
  expect(second.counts).toEqual(first.counts)
})

test("#given empty directory without git #when audited #then empty report succeeds", async () => {
  const { dir } = await repoWith([])
  await mkdir(join(dir, "empty"))
  expect((await auditMemoryRepo(join(dir, "empty"))).issues).toEqual([])
})

test("#given symlinked files and excluded directories #when audited #then they are never traversed", async () => {
  const { dir } = await repoWith([{ relativePath: "reference/a.md", content: memory("A", "Unique") }])
  await symlink(join(dir, "reference/a.md"), join(dir, "scratch.md"))
  await symlink(join(dir, "reference"), join(dir, "linked"))
  await mkdir(join(dir, ".tmp"))
  await writeFile(join(dir, ".tmp/bad.md"), "[[missing]]")
  await writeFile(join(dir, ".git/bad.md"), "[[missing]]")
  expect((await auditMemoryRepo(dir)).issues).toEqual([])
})

test("#given links that do resolve in markdown syntax variants #when audited #then none is reported dangling", async () => {
  // a link title, a link to a directory, and link syntax quoted in inline code all point nowhere wrong
  const { dir } = await repoWith([
    { relativePath: "reference/a.md", content: memory("A", "[t](exists.md \"Title\") [dir](../people/) see `[[reference/missing.md]]` and `[x](gone.md)`") },
    { relativePath: "reference/exists.md", content: memory("Exists", "Target") },
    { relativePath: "people/sam/card.md", content: memory("Sam", "Card") },
  ])
  expect((await auditMemoryRepo(dir)).issues).toEqual([])
})

test("#given files whose bodies are empty #when audited #then they are not reported as duplicates", async () => {
  const { dir } = await repoWith([
    { relativePath: "reference/a.md", content: "---\ndescription: A\n---\n" },
    { relativePath: "reference/b.md", content: "---\ndescription: B\n---\n" },
  ])
  expect((await auditMemoryRepo(dir)).counts.content_duplicate).toBe(0)
})

test("#given the legacy memory/ layout #when audited #then its homes are not orphans", async () => {
  // isMemoryContentPath and the pre-commit hook accept an optional memory/ prefix on every home
  const { dir } = await repoWith([{ relativePath: "memory/reference/a.md", content: memory("A", "Legacy layout") }])
  expect((await auditMemoryRepo(dir)).counts.path_orphan).toBe(0)
})

test("#given escaping markdown target #when audited #then confinement failure is explicit", async () => {
  const { dir } = await repoWith([{ relativePath: "reference/a.md", content: memory("A", "[outside](../../outside.md)") }])
  expect((await auditMemoryRepo(dir)).issues).toEqual([
    { code: "link_dangling", path: "reference/a.md", detail: "../../outside.md (escapes repository)" },
  ])
})
