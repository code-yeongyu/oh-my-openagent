import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const homes: string[] = []
const packageRoot = resolve(import.meta.dir, "..")
const packageJson: { bin: { omo: string } } = await Bun.file(join(packageRoot, "package.json")).json()
const omoEntry = join(packageRoot, packageJson.bin.omo)

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

async function runFirstCommand(args: readonly string[]): Promise<{ readonly home: string; readonly code: number }> {
  const home = mkdtempSync(join(tmpdir(), "omo-agent-dir-entry-"))
  homes.push(home)
  // The child inherits the umask at spawn time; restore it right after so no other test sees 0002.
  const previous = process.umask(0o002)
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([process.execPath, omoEntry, ...args], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun", OMO_SERVICE_API_URL: "http://127.0.0.1:1" },
      stdin: "ignore", stdout: "ignore", stderr: "ignore",
    })
  } finally {
    process.umask(previous)
  }
  return { home, code: await child.exited }
}

describe("omo entry prepares the agent directory before any command (#12546)", () => {
  describe("#given a fresh home and a umask of 0002", () => {
    describe("#when `omo setup` is the first command", () => {
      test.skipIf(process.platform === "win32")("#then ~/.omo/agent exists and is owner-only", async () => {
        // when
        const { home, code } = await runFirstCommand(["setup", "--dry-run"])

        // then
        const agentDir = join(home, ".omo", "agent")
        expect({ code, exists: existsSync(agentDir) }).toEqual({ code: 0, exists: true })
        expect(statSync(agentDir).mode & 0o777).toBe(0o700)
      }, 30_000)
    })
  })
})
