/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "../../../..")
const cliPath = join(repoRoot, "packages", "omo-senpi", "src", "install", "cli-local.ts")
const pluginPath = join(repoRoot, "packages", "omo-senpi", "plugin")
const tempDirs: string[] = []

async function makeAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omo-senpi-cli-local-test-"))
  tempDirs.push(dir)
  return dir
}

async function runCliLocal(action: string, agentDir: string): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(["bun", "run", cliPath, action], {
    cwd: repoRoot,
    env: { ...process.env, SENPI_CODING_AGENT_DIR: agentDir },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("cli-local", () => {
  test("#given isolated agent dir #when install then uninstall are invoked #then stdout is one-line JSON and settings round-trip", async () => {
    // given
    const agentDir = await makeAgentDir()

    // when
    const install = await runCliLocal("install", agentDir)
    const installedSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] }
    const uninstall = await runCliLocal("uninstall", agentDir)
    const uninstalledSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] }

    // then
    expect(install.exitCode).toBe(0)
    expect(JSON.parse(install.stdout)).toMatchObject({ ok: true, action: "install" })
    expect(install.stdout.trim().split("\n")).toHaveLength(1)
    expect(installedSettings.packages).toEqual([pluginPath])
    expect(uninstall.exitCode).toBe(0)
    expect(JSON.parse(uninstall.stdout)).toMatchObject({ ok: true, action: "uninstall" })
    expect(uninstall.stdout.trim().split("\n")).toHaveLength(1)
    expect(uninstalledSettings.packages).toEqual([])
    expect(install.stderr).toBe("")
  })

  test("#given invalid positional arg #when invoked #then it exits non-zero with one-line JSON error", async () => {
    // given
    const agentDir = await makeAgentDir()

    // when
    const result = await runCliLocal("bogus", agentDir)

    // then
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: expect.stringContaining("install|uninstall") })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
  })
})
