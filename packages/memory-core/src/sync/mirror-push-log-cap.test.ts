import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { PUSH_LOG_MAX_LINES, SYNC_PUSH_ENV, mirrorLogPath } from "./mirror"
import { createMirrorRepo, initBareMirror } from "./mirror.test-support"

// These cases drive real git end to end; loaded CI runners need more than the 20 s default.
setDefaultTimeout(30_000)

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

describe("mirror push log cap (#15421)", () => {
  test("#given a push log past the cap #when a commit's post-commit hook pushes #then the log keeps only its newest lines, the new attempt included", async () => {
    // given
    const { dir, mirror } = await createMirrorRepo(await tempDir("memory-mirror-log-cap-"))
    const bare = await tempDir("memory-mirror-log-cap-bare-")
    await initBareMirror(bare)
    expect((await mirror.set(`file://${bare}`)).pushed).toBe(true)
    const old = Array.from({ length: PUSH_LOG_MAX_LINES + 500 }, (_, index) => `old attempt ${index}`)
    await writeFile(mirrorLogPath(dir), `${old.join("\n")}\n`, "utf8")

    // when
    await writeFile(join(dir, "system", "persona.md"), "capped\n", "utf8")
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["commit", "-qm", "write persona"], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, [SYNC_PUSH_ENV]: "1", GIT_TERMINAL_PROMPT: "0" },
    })

    // then
    const lines = (await readFile(mirrorLogPath(dir), "utf8")).split("\n").filter((line) => line.length > 0)
    expect(lines.length).toBeLessThanOrEqual(PUSH_LOG_MAX_LINES)
    expect(lines.at(-1)).toBe("exit=0")
    expect(lines).not.toContain("old attempt 0")
    expect(lines).toContain(`old attempt ${old.length - 1}`)
  })
})
