import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const git = promisify(execFile)
const repo = process.env.MEMORY_DIR
if (!repo) throw new Error("MEMORY_DIR missing")
const path = process.env.AUDIT_PATH
if (path) {
  const audit = JSON.parse(await readFile(path, "utf8"))
  if (audit.counts.link_dangling !== 1 || audit.counts.content_duplicate !== 1 || audit.counts.path_orphan !== 1) {
    throw new Error("three-defect audit input missing")
  }
  const source = join(repo, "reference/a.md")
  await writeFile(source, (await readFile(source, "utf8")).replace("reference/moved.md", "reference/moved-here.md"))
  await writeFile(join(repo, "reference/dup2.md"), "---\ndescription: Duplicate pointer\n---\n[[reference/dup1.md]]\n")
  await mkdir(join(repo, "reference"), { recursive: true })
  await git("git", ["mv", "scratch/stray.md", "reference/stray.md"], { cwd: repo })
  await git("git", ["add", "reference"], { cwd: repo })
  await git("git", ["commit", "-m", "fix(dream): repair corpus structure"], { cwd: repo })
  console.log("fixed link_dangling 1, content_duplicate 1, path_orphan 1 / left none")
} else {
  console.log("No audit input; structural repairs unavailable")
}
