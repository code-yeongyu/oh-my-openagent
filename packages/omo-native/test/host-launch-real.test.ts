import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { RpcClient } from "../../../node_modules/@code-yeongyu/senpi/dist/modes/rpc/rpc-client.js"
import { resolveSenpi } from "../bin/lib/package-paths.js"

test.skipIf(process.platform === "win32")(
  "npm ensure opens a real session with thread_send; a live bare primary is reported, not killed",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "hl-"))
    const agent = join(home, "a")
    const pkg = join(home, "pkg")
    const socket = join(agent, "rpc/rpc.sock")
    const native = resolve(import.meta.dir, "..")
    const launcher = join(pkg, "bin/omo.js")
    const engine = resolveSenpi().cliPath
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      OMO_RUNTIME: "node",
      SENPI_RUNTIME: "node",
      OMO_CODING_AGENT_DIR: agent,
      SENPI_CODING_AGENT_DIR: agent,
    }
    const call = (entry: string, ...args: string[]) =>
      spawnSync("node", [entry, ...args], { env, cwd: home, encoding: "utf8", timeout: 90_000 })
    let pid: number | undefined
    let client: RpcClient | undefined
    const stop = () => {
      if (pid === undefined) return
      const result = call(engine, "host", "stop", "--socket", socket, "--drain", "--wait-ms", "10000")
      if (result.status !== 0 || JSON.parse(result.stdout).exited !== true) {
        try {
          process.kill(pid, "SIGTERM")
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e
        }
        throw new Error(`scratch host did not confirm exit: ${result.stdout}${result.stderr}`)
      }
      pid = undefined
    }
    try {
      mkdirSync(join(agent, "extensions"), { recursive: true, mode: 0o700 })
      mkdirSync(pkg)
      cpSync(join(native, "bin"), join(pkg, "bin"), { recursive: true })
      cpSync(join(native, "package.json"), join(pkg, "package.json"))
      symlinkSync(resolve(native, "../../node_modules"), join(pkg, "node_modules"))
      symlinkSync(resolve(native, "../omo-senpi/plugin"), join(pkg, "plugin"))
      writeFileSync(
        join(agent, "extensions", "inspect-tools.js"),
        `
      export default pi => pi.rpc.handle("fixture.tools", async () => pi.getAllTools().map(tool => tool.name))
    `,
      )
      const started = call(launcher, "host", "ensure", "--json")
      expect(started.status, started.stderr + started.stdout).toBe(0)
      pid = JSON.parse(started.stdout).pid
      client = new RpcClient({ socketPath: socket, keyRoot: agent })
      await client.start()
      await client.openSession({ cwd: home })
      expect(await client.requestExtension("fixture.tools")).toContain("thread_send")
      await client.closeSession()
      await client.stop()
      client = undefined
      stop()

      const bare = call(engine, "host", "ensure", "--socket", socket, "--json")
      expect(bare.status, bare.stderr + bare.stdout).toBe(0)
      const identity = JSON.parse(bare.stdout)
      pid = identity.pid
      const reused = call(launcher, "host", "ensure", "--policy", "never", "--json")
      expect(reused.status, reused.stdout + reused.stderr).toBe(3)
      expect(JSON.parse(reused.stdout)).toMatchObject({
        action: "refuse",
        reason: "primary_without_product_plugin",
        productPlugin: "absent",
        instanceId: identity.instanceId,
      })
    } finally {
      try {
        await client?.stop()
      } finally {
        try {
          stop()
        } finally {
          rmSync(home, { recursive: true, force: true })
        }
      }
    }
  },
)
