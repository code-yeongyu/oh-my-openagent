import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { once } from "node:events"
import { spawn } from "node:child_process"
import { startCompiledAutoUpdate } from "../compiled-auto-update"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-auto-state-"))
  roots.push(root)
  return { root, env: { OMO_CODING_AGENT_DIR: root } }
}

describe("standalone startup updates", () => {
  const release = { output: "omo updated 1.0.0 -> 1.0.1", exitCode: 0 }

  test("#given an interactive release launch #then the shared updater runs asynchronously and reports its result", async () => {
    const f = await fixture()
    const lines: string[] = []
    let updates = 0
    const completion = startCompiledAutoUpdate({
      args: [],
      interactive: true,
      release: true,
      launcher: "/install/omo",
      env: f.env,
      update: async () => {
        updates += 1
        return release
      },
      report: (line) => lines.push(line),
    })
    expect(completion).toBeInstanceOf(Promise)
    await completion
    expect(updates).toBe(1)
    expect(lines).toEqual([release.output])
  })

  for (const overrides of [
    { interactive: false },
    { release: false },
    { launcher: undefined },
    { args: ["--mode", "rpc"] },
    { args: ["host", "ensure"] },
    { args: ["update"] },
    { args: ["--print", "hello"] },
    { args: ["--version"] },
    { env: { OMO_OFFLINE: "1" } },
    { env: { SENPI_OFFLINE: "1" } },
    { env: { OMO_SKIP_VERSION_CHECK: "1" } },
    { env: { SENPI_SKIP_VERSION_CHECK: "1" } },
  ]) {
    test(`#given excluded startup ${JSON.stringify(overrides)} #then no download or install starts`, async () => {
      let updates = 0
      await startCompiledAutoUpdate({
        args: [],
        interactive: true,
        release: true,
        launcher: "/install/omo",
        env: {},
        update: async () => {
          updates += 1
          return release
        },
        report: () => {},
        ...overrides,
      })
      expect(updates).toBe(0)
    })
  }

  test("#given an update refusal #then startup survives and the reason is reported", async () => {
    const f = await fixture()
    const lines: string[] = []
    await startCompiledAutoUpdate({
      args: [],
      interactive: true,
      release: true,
      launcher: "/install/omo",
      env: f.env,
      update: async () => ({ output: "omo update: directory_not_writable", exitCode: 1 }),
      report: (line) => lines.push(line),
    })
    expect(lines).toEqual(["omo update: directory_not_writable"])
  })

  test("#given repeated concurrent launches on one day #then only one release check starts", async () => {
    const f = await fixture()
    let updates = 0
    const options = {
      args: [],
      interactive: true,
      release: true,
      launcher: "/install/omo",
      env: f.env,
      update: async () => {
        updates += 1
        return release
      },
      report: () => {},
    }
    await Promise.all([0, 1, 2, 3].map(() => startCompiledAutoUpdate(options)))
    await startCompiledAutoUpdate(options)
    expect(updates).toBe(1)
  })

  test("#given the next daily interval #then checking resumes and older scheduling markers are pruned", async () => {
    const f = await fixture()
    let updates = 0
    const options = {
      args: [],
      interactive: true,
      release: true,
      launcher: "/install/omo",
      env: f.env,
      update: async () => {
        updates += 1
        return release
      },
      report: () => {},
    }
    await startCompiledAutoUpdate(options)
    const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60_000)
    try {
      await startCompiledAutoUpdate(options)
      expect(updates).toBe(2)
      expect(await readdir(join(f.root, "auto-update-checks"))).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })

  test.skipIf(process.platform === "win32")(
    "#given the default detached updater fails #then diagnostics go to the local log and stderr remains empty",
    async () => {
      const f = await fixture()
      const launcher = join(f.root, "omo")
      await writeFile(launcher, "#!/bin/sh\nexit 7\n", { mode: 0o755 })
      const source = `
      import { startCompiledAutoUpdate } from ${JSON.stringify(new URL("../compiled-auto-update.ts", import.meta.url).href)};
      const anchor = setInterval(() => {}, 1000);
      try {
        await startCompiledAutoUpdate({
          args: [], interactive: true, release: true, launcher: process.env.TEST_LAUNCHER,
          env: { OMO_CODING_AGENT_DIR: process.env.TEST_AGENT_DIR },
        });
      } finally { clearInterval(anchor); }
    `
      const child = Bun.spawn([process.execPath, "-e", source], {
        env: { ...process.env, TEST_LAUNCHER: launcher, TEST_AGENT_DIR: f.root },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      expect(await readFile(join(f.root, "auto-update.log"), "utf8")).toContain("updater exited 7")
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given default startup updating #then a separate installed launcher receives update without inherited Bun CLI mode",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "omo-auto-update-"))
      const launcher = join(root, "omo")
      const marker = join(root, "called")
      try {
        await writeFile(launcher, `#!/bin/sh\nprintf '%s:%s' "$1" "\${BUN_BE_BUN-unset}" > "$MARKER"\n`, {
          mode: 0o755,
        })
        // A referenced handle represents the live interactive session while its unref'd updater runs.
        const anchor = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
          env: process.env,
          stdio: ["pipe", "ignore", "ignore"],
        })
        try {
          await startCompiledAutoUpdate({
            args: [],
            interactive: true,
            release: true,
            launcher,
            env: { ...process.env, MARKER: marker, BUN_BE_BUN: "1", OMO_CODING_AGENT_DIR: join(root, "agent") },
            report: (line) => {
              throw new Error(line)
            },
          })
          expect(await readFile(marker, "utf8")).toBe("update:unset")
        } finally {
          anchor.stdin?.end()
          await once(anchor, "exit")
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
