import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The engine runs on Node or Bun, and each runtime is started fresh with HOME at a temp dir and USERPROFILE unset:
// os.homedir() reads HOME at startup, and Bun's userInfo().homedir follows HOME too (#14622 review M4). The account's
// real home comes from Node's userInfo(), which reads the passwd entry. The Bun case also runs with no getent on PATH.
const runtimes = [
  ["node", "node", undefined],
  ["bun", process.versions.bun === undefined ? "bun" : process.execPath, undefined],
  ["bun with no getent on PATH", process.versions.bun === undefined ? "bun" : process.execPath, "/nonexistent"],
] as const

test.skipIf(process.platform === "win32").each(runtimes)(
  "#given %s started with HOME at a temp dir and no USERPROFILE #when the agent dir is the account home's store #then it is shared",
  (_runtime, executable, path) => {
    const alternate = mkdtempSync(join(tmpdir(), "agent-home-alt-"))
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: alternate, ...(path === undefined ? {} : { PATH: path }) }
      delete env.USERPROFILE
      const run = (command: string, args: string[], runEnv: NodeJS.ProcessEnv) => {
        const probe = spawnSync(command, args, { env: runEnv, encoding: "utf8", windowsHide: true })
        expect(probe.stderr).toBe("")
        return probe.stdout.trim()
      }
      const accountHome = run("node", ["-e", `console.log(require("node:os").userInfo().homedir)`], {
        ...env,
        PATH: process.env.PATH,
      })
      expect(accountHome).not.toBe(alternate)
      const module = JSON.stringify(join(import.meta.dirname, "dev-build-runtime.ts"))
      const store = JSON.stringify(join(accountHome, ".omo", "agent"))
      const args = ["-e", `import { isSharedAgentDir } from ${module}; console.log(isSharedAgentDir(${store}))`]
      expect(run(executable, executable === "node" ? ["--input-type=module", ...args] : args, env)).toBe("true")
    } finally {
      rmSync(alternate, { recursive: true, force: true })
    }
  },
)
