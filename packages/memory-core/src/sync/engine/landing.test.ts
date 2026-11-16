import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { commitPathProblem, prepareLanding } from "./landing"

const posix = process.platform === "win32" ? test.skip : test

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
  expect(commitPathProblem(GIT_WINDOWS_ROOT, grammarValidKeyOfLength(longestAllowed + 1), "win32")).toBe(
    "git-path-too-long",
  )
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
    expect(await prepareLanding(root, key)).toEqual(
      process.platform === "win32" ? { refused: "git-path-too-long" } : { path: key, working: null },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

posix(
  "a FIFO at a received key's path is refused with a receipt instead of blocking the cycle",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
    try {
      const key = "memory/note.md"
      await mkdir(join(root, "memory"), { recursive: true })
      const made = Bun.spawn(["mkfifo", join(root, key)])
      expect(await made.exited).toBe(0)
      // The pre-fix code read the leaf here, which blocks on a FIFO until a writer opens it. The
      // bounded race keeps that run from hanging the suite: it settles as a timeout instead.
      // #12568 review: clear the 5-second race timer once `prepareLanding` wins, so the test
      // does not leave a stray timer alive after it settles.
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<{ kind: "timed-out" }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "timed-out" }), 5_000)
      })
      try {
        const settled = await Promise.race([
          prepareLanding(root, key).then((result) => ({ kind: "landed" as const, result })),
          timeout,
        ])
        expect(settled).toEqual({ kind: "landed", result: { refused: "non-regular-file" } })
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  10_000,
)

test("an existing directory at a received key's path is refused as a non-regular leaf", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
  try {
    const key = "memory/note.md"
    await mkdir(join(root, key), { recursive: true })
    expect(await prepareLanding(root, key)).toEqual({ refused: "non-regular-file" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a regular file at a received key's path still lands with its working text", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
  try {
    const key = "memory/note.md"
    await mkdir(join(root, "memory"), { recursive: true })
    await writeFile(join(root, key), "hello\n", "utf8")
    expect(await prepareLanding(root, key)).toEqual({ path: key, working: "hello\n" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
