/// <reference types="bun-types" />

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const GIT_IDENTITY = [
  "-c",
  "user.name=QA",
  "-c",
  "user.email=qa@example.invalid",
  "-c",
  "commit.gpgsign=false",
]

const createdDirs: string[] = []

export function makeTempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  createdDirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
}

export function git(root: string, args: readonly string[], input?: string): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: root, encoding: "utf8", input })
}

export function initRepo(prefix = "omo-init-deep-fixture-"): string {
  const root = makeTempDir(prefix)
  git(root, ["init", "--initial-branch=main"])
  return root
}

export function writeFileAt(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

export function commitAll(root: string, message: string): string {
  git(root, ["add", "-A"])
  git(root, ["commit", "--allow-empty", "-m", message])
  return git(root, ["rev-parse", "HEAD"]).trim()
}

export function advanceCommits(
  root: string,
  baseSha: string,
  count: number,
  touchedFileIndexes: readonly number[],
): void {
  const stream: string[] = []
  for (let step = 0; step < count; step++) {
    const mark = step + 1
    const message = `drift ${step}`
    stream.push(
      "commit refs/heads/main",
      `mark :${mark}`,
      `committer QA <qa@example.invalid> ${1_700_000_000 + step} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      step === 0 ? `from ${baseSha}` : `from :${mark - 1}`,
    )
    for (const fileIndex of touchedFileIndexes) {
      const content = sourceFile(100 + step + 1)
      stream.push(
        `M 100644 inline src/file${fileIndex}.ts`,
        `data ${Buffer.byteLength(content)}`,
        content,
      )
    }
    stream.push("")
  }
  stream.push("done", "")
  git(root, ["fast-import", "--quiet"], stream.join("\n"))
  git(root, ["reset", "--hard", "HEAD"])
}

export function sourceFile(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = ${index}`).join("\n")
}

export function makeDirWithSourceFiles(
  root: string,
  relativeDir: string,
  fileCount: number,
  linesPerFile = 3,
): void {
  for (let index = 0; index < fileCount; index++) {
    writeFileAt(root, join(relativeDir, `file${index}.ts`), sourceFile(linesPerFile))
  }
}
