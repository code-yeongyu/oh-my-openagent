import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { once } from "node:events"
import { spawn } from "node:child_process"
import { startCompiledAutoUpdate } from "../compiled-auto-update"

describe("standalone startup updates", () => {
  const release = { output: "omo updated 1.0.0 -> 1.0.1", exitCode: 0 }

  test("#given an interactive release launch #then the shared updater runs asynchronously and reports its result", async () => {
    const lines: string[] = []
    let updates = 0
    const completion = startCompiledAutoUpdate({
      args: [], interactive: true, release: true, launcher: "/install/omo", env: {},
      update: async () => { updates += 1; return release },
      report: (line) => lines.push(line),
    })
    expect(completion).toBeInstanceOf(Promise)
    await completion
    expect(updates).toBe(1)
    expect(lines).toEqual([release.output])
  })

  for (const overrides of [
    { interactive: false }, { release: false }, { launcher: undefined },
    { args: ["--mode", "rpc"] }, { args: ["host", "ensure"] }, { args: ["update"] },
    { args: ["--print", "hello"] }, { args: ["--version"] },
    { env: { OMO_OFFLINE: "1" } }, { env: { SENPI_OFFLINE: "1" } },
    { env: { OMO_SKIP_VERSION_CHECK: "1" } }, { env: { SENPI_SKIP_VERSION_CHECK: "1" } },
  ]) {
    test(`#given excluded startup ${JSON.stringify(overrides)} #then no download or install starts`, async () => {
      let updates = 0
      await startCompiledAutoUpdate({
        args: [], interactive: true, release: true, launcher: "/install/omo", env: {},
        update: async () => { updates += 1; return release }, report: () => {},
        ...overrides,
      })
      expect(updates).toBe(0)
    })
  }

  test("#given an update refusal #then startup survives and the reason is reported", async () => {
    const lines: string[] = []
    await startCompiledAutoUpdate({
      args: [], interactive: true, release: true, launcher: "/install/omo", env: {},
      update: async () => ({ output: "omo update: directory_not_writable", exitCode: 1 }),
      report: (line) => lines.push(line),
    })
    expect(lines).toEqual(["omo update: directory_not_writable"])
  })

  test.skipIf(process.platform === "win32")("#given default startup updating #then a separate installed launcher receives update without inherited Bun CLI mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-auto-update-"))
    const launcher = join(root, "omo")
    const marker = join(root, "called")
    try {
      await writeFile(launcher, `#!/bin/sh\nprintf '%s:%s' "$1" "\${BUN_BE_BUN-unset}" > "$MARKER"\n`, { mode: 0o755 })
      // A referenced handle represents the live interactive session while its unref'd updater runs.
      const anchor = spawn(process.execPath, ["-e", "process.stdin.resume()"], { env: process.env, stdio: ["pipe", "ignore", "ignore"] })
      try {
        await startCompiledAutoUpdate({
          args: [], interactive: true, release: true, launcher,
          env: { ...process.env, MARKER: marker, BUN_BE_BUN: "1" },
          report: (line) => { throw new Error(line) },
        })
        expect(await readFile(marker, "utf8")).toBe("update:unset")
      } finally {
        anchor.stdin?.end()
        await once(anchor, "exit")
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
