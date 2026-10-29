import { afterEach, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, createNodeGitExec } from "./index"
import { renderMemoryFile } from "../memfs/frontmatter"

const directories: string[] = []
const AUTHOR = { agentId: "alias-boundary", authorName: "Alias Boundary", authorEmail: "alias@example.test" }

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

setDefaultTimeout(process.platform === "win32" ? 30_000 : 15_000)

it("#given two case spellings in HEAD #when an ambiguous third spelling is restored #then ownership is refused without deleting either entry", async () => {
  // given
  const dir = await mkdtemp(join(tmpdir(), "memory-head-alias-"))
  directories.push(dir)
  const canonical = "reference/Notes.md"
  const alias = "reference/notes.md"
  const probe = "reference/NOTES.md"
  const original = renderMemoryFile({ description: "Alias boundary" }, "\noriginal\n")
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName, seedFiles: [{ relativePath: canonical, content: original }] })
  await repo.configSet("core.ignorecase", "false")
  await writeFile(join(dir, alias), original)
  const exec = createNodeGitExec()
  const options = { cwd: dir, timeoutMs: 30_000 }
  const blob = await exec.run(["rev-parse", `HEAD:${canonical}`], options)
  expect(blob.code).toBe(0)
  const staged = await exec.run(["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${alias}`], options)
  expect(staged.code).toBe(0)
  await repo.commitPrepared([alias], "seed case collision", AUTHOR)
  const head = await repo.head()
  const status = await repo.status()
  const insensitive = existsSync(join(dir, probe))

  // when
  let failure: unknown
  try {
    await repo.restorePaths([probe])
  } catch (error) {
    failure = error
  }

  // then
  expect({
    error: failure === undefined ? null : failure instanceof Error ? failure.name : "non_error",
    head: await repo.head(),
    canonical: existsSync(join(dir, canonical)) ? await readFile(join(dir, canonical), "utf8") : null,
    alias: existsSync(join(dir, alias)) ? await readFile(join(dir, alias), "utf8") : null,
    status: await repo.status(),
  }).toEqual({ error: insensitive ? "InvalidGitPathError" : null, head, canonical: original, alias: original, status })
})
