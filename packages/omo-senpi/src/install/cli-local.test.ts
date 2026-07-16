/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "../../../..")
const cliPath = join(repoRoot, "packages", "omo-senpi", "src", "install", "cli-local.ts")
const tempDirs: string[] = []

async function makeAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omo-senpi-cli-local-test-"))
  tempDirs.push(dir)
  return dir
}

async function makePackagedPlugin(): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-senpi-cli-plugin-"))
  tempDirs.push(pluginPath)
  await writeFixtureFile(join(pluginPath, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
  await writeFixtureFile(join(pluginPath, "extensions", "omo.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "skills", "ultrawork", "SKILL.md"), "# Ultrawork\n")
  await writeFixtureFile(join(pluginPath, "skills", "ulw-loop", "SKILL.md"), "# ULW Loop\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "cli.js"), "console.log('cli')\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.d.ts"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.js"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.d.ts"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "package.json"), JSON.stringify({ version: "0.1.0" }))
  await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"), "{}\n")
  await buildInstaller(pluginPath)
  return pluginPath
}

async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function buildInstaller(pluginPath: string): Promise<void> {
  await mkdir(join(pluginPath, "scripts"), { recursive: true })
  const proc = Bun.spawn([
    "bun",
    "build",
    cliPath,
    "--target",
    "node",
    "--format",
    "esm",
    "--outfile",
    join(pluginPath, "scripts", "install.mjs"),
  ], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`installer build failed: ${stdout}${stderr}`)
}

async function runCliLocal(
  action: string,
  agentDir: string,
  pluginPath: string,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(["node", join(pluginPath, "scripts", "install.mjs"), action], {
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
    const pluginPath = await makePackagedPlugin()

    // when
    const install = await runCliLocal("install", agentDir, pluginPath)
    const installedSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] }
    const uninstall = await runCliLocal("uninstall", agentDir, pluginPath)
    const uninstalledSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] }

    // then
    expect(install.exitCode).toBe(0)
    const installResult = JSON.parse(install.stdout) as { readonly pluginPath: string }
    expect(installResult).toMatchObject({ ok: true, action: "install" })
    expect(install.stdout.trim().split("\n")).toHaveLength(1)
    expect(installedSettings.packages).toEqual([installResult.pluginPath])
    expect(uninstall.exitCode).toBe(0)
    expect(JSON.parse(uninstall.stdout)).toMatchObject({ ok: true, action: "uninstall" })
    expect(uninstall.stdout.trim().split("\n")).toHaveLength(1)
    expect(uninstalledSettings.packages).toEqual([])
    expect(install.stderr).toBe("")
  })

  test("#given invalid positional arg #when invoked #then it exits non-zero with one-line JSON error", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePackagedPlugin()

    // when
    const result = await runCliLocal("bogus", agentDir, pluginPath)

    // then
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: expect.stringContaining("install|uninstall") })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
  })
})
