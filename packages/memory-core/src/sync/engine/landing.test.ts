import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { commitPathProblem, prepareLanding } from "./landing"

const GIT_WINDOWS_MAX_PATH_CHARS = 260
const GIT_WINDOWS_ROOT = "C:\\Users\\ann\\AppData\\Roaming\\omo\\memory"

function grammarValidKeyOfLength(length: number): string {
  const segment = "a".repeat(200)
  const segments: string[] = []
  let used = 0
  while (used + segment.length + 1 <= length) {
    segments.push(segment)
    used += segment.length + 1
  }
  const rest = length - used
  if (rest > 0) segments.push("b".repeat(rest))
  return segments.join("/")
}

test("win32 refuses a path at or past the length its git opens, and only from there", () => {
  const longestAllowed = GIT_WINDOWS_MAX_PATH_CHARS - GIT_WINDOWS_ROOT.length - 2
  expect(grammarValidKeyOfLength(longestAllowed)).toHaveLength(longestAllowed)
  expect(commitPathProblem(GIT_WINDOWS_ROOT, grammarValidKeyOfLength(longestAllowed), "win32")).toBeNull()
  expect(commitPathProblem(`${GIT_WINDOWS_ROOT}\\`, grammarValidKeyOfLength(longestAllowed), "win32")).toBeNull()
  expect(commitPathProblem(GIT_WINDOWS_ROOT, grammarValidKeyOfLength(longestAllowed + 1), "win32")).toBe("git-path-too-long")
})

test("win32 refuses a key inside the grammar whose working path git cannot open", () => {
  const key = grammarValidKeyOfLength(4000)
  expect(key.length).toBeLessThanOrEqual(4096)
  expect(commitPathProblem(GIT_WINDOWS_ROOT, key, "win32")).toBe("git-path-too-long")
})

test("POSIX leaves the decision to its own path probe, so the Windows limit never bites there", () => {
  const key = grammarValidKeyOfLength(300)
  expect(commitPathProblem("/home/ann/.omo/memory", key, "linux")).toBeNull()
  expect(commitPathProblem("/Users/ann/.omo/memory", key, "darwin")).toBeNull()
})

test("a landing follows this platform's git capacity", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
  try {
    const key = grammarValidKeyOfLength(300)
    // POSIX decides through its own probe and accepts this path; Windows reaches the same key past MAX_PATH, where git could not stage it, so it is refused before anything is written.
    expect(await prepareLanding(root, key)).toEqual(process.platform === "win32" ? { refused: "git-path-too-long" } : { path: key, working: null })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
