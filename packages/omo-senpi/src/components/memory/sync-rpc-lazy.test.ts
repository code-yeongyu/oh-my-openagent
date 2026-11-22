import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

test("#given the shipped extension #when the first sync verb is called #then eagerly discovered handlers load the RPC sidecar only on use", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-rpc-lazy-"))
  try {
    const probe = fileURLToPath(new URL("./sync-rpc-lazy.fixture.ts", import.meta.url))
    const child = Bun.spawn([Bun.which("bun") ?? process.execPath, probe], {
      cwd: home,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: home,
        TEMP: home,
        TMP: home,
        CI: "1",
        OMO_MEMORY_HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const result = stdout.split("\n").find((line) => line.startsWith("SYNC_RPC_PROBE "))
    if (exitCode !== 0 || result === undefined)
      throw new Error(`Sync RPC probe exited ${exitCode}\n${stdout}\n${stderr}`)

    expect(JSON.parse(result.slice("SYNC_RPC_PROBE ".length))).toEqual({
      registered: ["acknowledge", "approve", "devices", "disable", "enable", "features", "pending", "status"].map(
        (verb) => `omo.memory.sync.${verb}`,
      ),
      registrationLoads: 0,
      startupLoads: 0,
      firstUseLoads: 1,
      totalLoads: 1,
      reply: { features: ["enable-method", "acknowledge", "disable"] },
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
