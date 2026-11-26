import { readFileSync } from "node:fs"
import { join } from "node:path"

function data(text: string): string {
  return `data ${Buffer.byteLength(text)}\n${text}\n`
}

function file(path: string, text: string): string {
  return `M 100644 inline ${path}\n${data(text)}`
}

/** Build the merged origin in one import; the runner still fetches both real SHAs from origin. */
export function createMergedSelectionFixture(
  root: string,
  version: string,
  extraContent: boolean,
  git: (cwd: string, args: string[], input?: string) => string,
) {
  const origin = join(root, "origin.git")
  const work = join(root, "work")
  const marks = join(root, "marks")
  const stampMessage = `release: v${version}`
  const stampedFile = file("file.txt", `${stampMessage}\n`)
  const commit = (mark: number, message: string) =>
    `commit refs/heads/dev\nmark :${mark}\ncommitter t <t@example.invalid> 1700000000 +0000\n${data(message)}`
  // The first parent is dev (with or without a separate change), the second is the original stamp.
  const stream = [
    commit(1, "initial") + file("file.txt", "initial\n"),
    commit(2, stampMessage) + "from :1\n" + stampedFile,
    extraContent ? commit(3, "later change") + "from :1\n" + file("later.txt", "merged after preparation\n") : "",
    commit(4, `Merge release\n\n${stampMessage}`) + `from :${extraContent ? 3 : 1}\nmerge :2\n` + stampedFile,
  ].join("")
  git(root, ["init", "-q", "--bare", "-b", "dev", origin])
  git(origin, ["fast-import", "--quiet", `--export-marks=${marks}`], stream)
  const ids = new Map(readFileSync(marks, "utf8").trim().split("\n").map((line) => {
    const [mark, id] = line.split(" ")
    return [mark, id]
  }))
  const stamp = ids.get(":2")
  const merge = ids.get(":4")
  if (!stamp || !merge) throw new Error("fast-import did not export the stamp and merge commits")

  git(root, ["init", "-q", work])
  git(work, ["remote", "add", "origin", origin])
  return { root, origin, work, stamp, merge }
}
