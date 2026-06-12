/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const rootPackageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const publishWorkflowPath = fileURLToPath(new URL("../.github/workflows/publish.yml", import.meta.url))

describe("node-target CLI build (lazycodex#47)", () => {
  test("build:cli-node produces a bundle that runs under plain node", () => {
    // #given
    const packageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
      scripts?: Record<string, string>
    }
    const buildScript = packageJson.scripts?.["build:cli-node"]
    expect(buildScript, "root package.json must define build:cli-node").toBeDefined()

    const build = spawnSync("bun", ["run", "build:cli-node"], { cwd: repoRoot, encoding: "utf8" })
    expect(build.status, `build:cli-node failed:\n${build.stderr}`).toBe(0)
    expect(existsSync(`${repoRoot}dist/cli-node/index.js`)).toBe(true)

    // #when
    const help = spawnSync("node", ["dist/cli-node/index.js", "--help"], { cwd: repoRoot, encoding: "utf8" })
    const version = spawnSync("node", ["dist/cli-node/index.js", "--version"], { cwd: repoRoot, encoding: "utf8" })

    // #then
    expect(help.status, `node dist/cli-node/index.js --help failed:\n${help.stderr}`).toBe(0)
    expect(help.stdout).toContain("Usage:")
    expect(version.status).toBe(0)
  }, 120_000)

  test("the node CLI bundle runs from an isolated payload with no node_modules in reach", async () => {
    // #given the published lazycodex-ai payload ships dist/cli-node with .dependencies = {}
    // and no node_modules, so nothing may resolve from outside the bundle at load time
    const isolated = await mkdtemp(join(tmpdir(), "cli-node-isolated-"))
    await cp(`${repoRoot}dist/cli-node/index.js`, join(isolated, "index.js"))

    // #when
    const version = spawnSync("node", [join(isolated, "index.js"), "--version"], { encoding: "utf8" })
    const help = spawnSync("node", [join(isolated, "index.js"), "--help"], { encoding: "utf8" })

    // #then
    expect(version.status, `isolated node CLI --version failed:\n${version.stderr}`).toBe(0)
    expect(help.status, `isolated node CLI --help failed:\n${help.stderr}`).toBe(0)
    expect(help.stdout).toContain("Usage:")
  }, 60_000)

  test("doctor json runs under plain node without Bun globals", () => {
    // #given
    const build = spawnSync("bun", ["run", "build:cli-node"], { cwd: repoRoot, encoding: "utf8" })
    expect(build.status, `build:cli-node failed:\n${build.stderr}`).toBe(0)

    // #when
    const doctor = spawnSync("node", ["dist/cli-node/index.js", "doctor", "--json"], { cwd: repoRoot, encoding: "utf8" })

    // #then
    expect(doctor.stderr).not.toContain("Bun is not defined")
    expect(doctor.stderr).not.toContain("Doctor failed unexpectedly")
    const doctorStatus = doctor.status
    if (doctorStatus === null) throw new Error(`node doctor exited without a status:\n${doctor.stderr}`)
    const report = JSON.parse(doctor.stdout) as { exitCode?: number; summary?: { total?: number } }
    expect(report.exitCode).toBe(doctorStatus)
    expect(report.summary?.total).toBeGreaterThan(0)
  }, 120_000)

  test("the main build chain and the lazycodex-ai payload carry the node CLI", () => {
    // #given
    const packageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
      scripts?: Record<string, string>
    }
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #then
    expect(packageJson.scripts?.build, "root build script must produce dist/cli-node").toContain("build:cli-node")
    expect(workflow, "lazycodex-ai files list must ship dist/cli-node").toContain('"dist/cli-node"')
  })
})
