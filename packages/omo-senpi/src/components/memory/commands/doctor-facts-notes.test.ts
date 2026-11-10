import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkFactsNotes } from "./doctor-checks"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true })))
})

async function repoWithFacts(notes: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "omo-doctor-facts-"))
  roots.push(repo)
  await mkdir(join(repo, "notes", "facts", "archive"), { recursive: true })
  await Promise.all(Object.entries(notes).map(([name, content]) => writeFile(join(repo, "notes", "facts", name), content)))
  return repo
}

describe("doctor facts notes (#10884)", () => {
  test("#given one facts note over budget #when checked #then it warns naming that note with its size and lines", async () => {
    const repo = await repoWithFacts({ "2026-10.md": "a\n", "2026-11.md": "F\n".repeat(1_500), "archive/2026-01.md": "x".repeat(9_000) })

    const check = await checkFactsNotes(repo, 2_048)

    expect(check.level).toBe("warn")
    expect(check.detail).toContain("notes/facts/2026-11.md 2.9 KiB (1500 lines)")
    expect(check.detail).not.toContain("2026-10.md")
    expect(check.detail).not.toContain("archive")
  })

  test("#given notes within budget, a disabled budget, or no facts folder #when checked #then it is ok", async () => {
    const repo = await repoWithFacts({ "2026-11.md": "F".repeat(100) })
    const empty = await mkdtemp(join(tmpdir(), "omo-doctor-facts-"))
    roots.push(empty)

    expect((await checkFactsNotes(repo, 2_048)).level).toBe("ok")
    expect((await checkFactsNotes(repo, 0)).level).toBe("ok")
    expect(await checkFactsNotes(empty, 2_048)).toEqual({ name: "facts-notes", level: "ok", detail: "0 facts notes, all within 2.0 KiB" })
  })
})
