import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// `=======` alone is also a Markdown setext heading underline, so only the unambiguous
// open, diff3-base and close markers are rejected (#8919).
const MARKER_LINE = /^(?:<<<<<<<|\|\|\|\|\|\|\||>>>>>>>)(?: |$)/

function committedMarkerLines(repoRoot: string): string[] {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
  const found: string[] = []
  for (const file of tracked) {
    let bytes: Buffer
    try {
      bytes = readFileSync(join(repoRoot, file))
    } catch {
      continue
    }
    if (bytes.subarray(0, 8000).includes(0)) continue
    const lines = bytes.toString("utf8").split("\n")
    for (const [index, line] of lines.entries()) {
      if (MARKER_LINE.test(line)) found.push(`${file}:${index + 1}: ${line.slice(0, 80)}`)
    }
  }
  return found
}

function fixtureRepo(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "omo-conflict-markers-"))
  execFileSync("git", ["init", "-q"], { cwd: root })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  execFileSync("git", ["add", "."], { cwd: root })
  return root
}

describe("committed conflict markers", () => {
  test("#given a tracked orphan diff3 base marker #when scanned #then it is reported with path and line", () => {
    // given
    const root = fixtureRepo({ "changes.md": "## One\n\n||||||| parent of 1f032c2b4 (x)\n## Two\n" })

    try {
      // when
      const found = committedMarkerLines(root)

      // then
      expect(found).toEqual(["changes.md:3: ||||||| parent of 1f032c2b4 (x)"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given setext underlines, mid-line markers, binary and untracked files #when scanned #then nothing is reported", () => {
    // given
    const root = fixtureRepo({
      "README.md": "Title\n=======\n\ntext with <<<<<<< inside\n",
      "blob.bin": Buffer.concat([Buffer.from([0, 1]), Buffer.from("\n<<<<<<< HEAD\n")]),
    })
    writeFileSync(join(root, "scratch.md"), "<<<<<<< HEAD\n")

    try {
      // when
      const found = committedMarkerLines(root)

      // then
      expect(found).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given this repository #when scanned #then no tracked file carries a conflict marker", () => {
    // given
    const repoRoot = join(import.meta.dir, "..")

    // when
    const found = committedMarkerLines(repoRoot)

    // then
    expect(found).toEqual([])
  })
})
