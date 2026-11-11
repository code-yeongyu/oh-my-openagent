import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const homes: string[] = []
const packageRoot = resolve(import.meta.dir, "..")
const packageJson: { bin: { omo: string } } = await Bun.file(join(packageRoot, "package.json")).json()
const omoEntry = join(packageRoot, packageJson.bin.omo)
const detectRefresh = join(packageRoot, "bin", "lib", "setup-detect-refresh.js")

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omo-agent-dir-entry-"))
  homes.push(home)
  return home
}

async function runUnderUmask0002(home: string, argv: readonly string[]): Promise<number> {
  // The child inherits the umask at spawn time; restore it right after so no other test sees 0002.
  const previous = process.umask(0o002)
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([process.execPath, ...argv], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun", OMO_SERVICE_API_URL: "http://127.0.0.1:1" },
      stdin: "ignore", stdout: "ignore", stderr: "ignore",
    })
  } finally {
    process.umask(previous)
  }
  return await child.exited
}

describe("agent directory permissions on the paths that return before the engine starts (#12546)", () => {
  describe("#given a group-writable ~/.omo/agent left by an earlier run", () => {
    describe("#when `omo setup` is the first command", () => {
      test.skipIf(process.platform === "win32")("#then the entry removes the group/world write bits before setup runs", async () => {
        // given
        const home = freshHome()
        const agentDir = join(home, ".omo", "agent")
        mkdirSync(agentDir, { recursive: true })
        chmodSync(agentDir, 0o775)

        // when
        const code = await runUnderUmask0002(home, [omoEntry, "setup", "--dry-run"])

        // then
        // The host refuses only group/world-writable key dirs; the other mode bits are kept.
        expect(code).toBe(0)
        expect(statSync(agentDir).mode & 0o777).toBe(0o755)
      }, 30_000)
    })
  })

  describe("#given a fresh home and a umask of 0002", () => {
    describe("#when the setup-detect refresh writes its cache into the agent dir", () => {
      test.skipIf(process.platform === "win32")("#then it creates ~/.omo/agent owner-only", async () => {
        // given
        const home = freshHome()

        // when
        const code = await runUnderUmask0002(home, [detectRefresh])

        // then
        const agentDir = join(home, ".omo", "agent")
        expect({ code, exists: existsSync(agentDir) }).toEqual({ code: 0, exists: true })
        expect(statSync(agentDir).mode & 0o777).toBe(0o700)
      }, 30_000)
    })
  })
})
