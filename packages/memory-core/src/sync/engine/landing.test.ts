import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { commitPathProblem, fsRefusal, prepareLanding, readWorking } from "./landing"

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

// #12575: the kind of leaf is judged on the opened descriptor, so a FIFO swapped in after prepareLanding's lstat (or a
// known key's file replaced by one before capture) settles as a refusal instead of blocking the read.
posix(
  "reading a FIFO leaf settles at once with the non-regular-file refusal, with no writer on the other end",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
    try {
      // given
      const key = "memory/note.md"
      await mkdir(join(root, "memory"), { recursive: true })
      const made = Bun.spawn(["mkfifo", join(root, key)])
      expect(await made.exited).toBe(0)
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<{ kind: "timed-out" }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "timed-out" }), 5_000)
      })

      // when
      try {
        const settled = await Promise.race([
          readWorking(root, key).then(
            (text) => ({ kind: "read" as const, text }),
            (error: unknown) => ({ kind: "refused" as const, reason: fsRefusal(error)?.toLowerCase() }),
          ),
          timeout,
        ])

        // then
        expect(settled).toEqual({ kind: "refused", reason: "non-regular-file" })
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  10_000,
)

posix("reading a leaf that is a symlink fails instead of following it", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
  try {
    // given
    await mkdir(join(root, "memory"), { recursive: true })
    await writeFile(join(root, "memory", "real.md"), "real\n")
    await symlink("real.md", join(root, "memory", "note.md"))

    // when
    const reason = await readWorking(root, "memory/note.md").then(
      () => undefined,
      (error: unknown) => fsRefusal(error),
    )

    // then
    expect(reason).toBe("ELOOP")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

posix("reading a socket leaf is refused as a non-regular file instead of failing the cycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-landing-"))
  const server = createServer()
  try {
    // given
    const key = "memory/note.md"
    await mkdir(join(root, "memory"), { recursive: true })
    await new Promise<void>((resolve) => {
      server.listen(join(root, key), () => resolve())
    })

    // when
    const reason = await readWorking(root, key).then(
      () => undefined,
      (error: unknown) => fsRefusal(error)?.toLowerCase(),
    )

    // then
    expect(reason).toBe("non-regular-file")
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

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
