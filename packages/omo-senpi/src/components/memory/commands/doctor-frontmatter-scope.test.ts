import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { checkFrontmatter } from "./doctor-checks"

const VALID = "---\ndescription: A valid memory file\n---\n\nbody\n"
const NO_FRONTMATTER = "# Archive\n\n- 2026-03: summarized facts\n"

const dirs: string[] = []

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "doctor-frontmatter-scope-"))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("checkFrontmatter scope (#8866)", () => {
  test("#given a root ARCHIVE.md and notes/ file without frontmatter #when checked #then they are outside the contract and the check passes", async () => {
    // given: the dream persona's archive file and a fact file, neither under the frontmatter contract
    const repo = await repoWith({
      "system/persona.md": VALID,
      "reference/tools.md": VALID,
      "ARCHIVE.md": NO_FRONTMATTER,
      "notes/facts/2026-03.md": NO_FRONTMATTER,
    })

    // when
    const [frontmatter] = await checkFrontmatter(repo)

    // then
    expect(frontmatter).toEqual({ name: "frontmatter", level: "ok", detail: "2 memory files valid" })
  })

  test("#given a contract file without frontmatter #when checked #then it still fails and names only that file", async () => {
    // given
    const repo = await repoWith({
      "system/persona.md": VALID,
      "people/alice.md": NO_FRONTMATTER,
      "ARCHIVE.md": NO_FRONTMATTER,
    })

    // when
    const [frontmatter] = await checkFrontmatter(repo)

    // then
    expect(frontmatter?.level).toBe("fail")
    expect(frontmatter?.detail).toStartWith("1 invalid file: people/alice.md (")
    expect(frontmatter?.detail).not.toContain("ARCHIVE.md")
  })
})
