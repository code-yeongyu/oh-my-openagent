import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  fetchNpmDistTagsSync,
  latestFromDistTags,
  runDoctor,
} from "../bin/lib/doctor.js"
import { packageManifest, updateTarget } from "../bin/lib/package-paths.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []
const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
] as const

type Fixture = { root: string; packageRoot: string; launcher: string; agentDir: string }
type InstallLayout = "bun" | "npm"

function writeFile(path: string, content = "fixture\n"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createFixture(installLayout: InstallLayout = "npm"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-edition-"))
  roots.push(root)
  const packagePath = installLayout === "bun"
    ? join(root, "custom-bun", "install", "global", "node_modules", "omo-ai")
    : join(root, "prefix", "lib", "node_modules", "omo-ai")
  mkdirSync(packagePath, { recursive: true })
  // realpathSync.native returns the long canonical name on Windows (GetFinalPathNameByHandle); the JS
  // realpath keeps 8.3 aliases such as RUNNER~1, while the child resolves its own import.meta.url to the
  // long form, so the two spellings of one directory would disagree in the Update: line.
  const packageRoot = realpathSync.native(packagePath)
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "5.0.0-0.beta.51",
    type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.8.9",
    type: "module",
    exports: { ".": "./dist/index.js" },
  }))
  writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(senpiRoot, "dist", "cli.js"), "process.exit(0)\n")
  writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  for (const [, artifact] of artifacts) writeFile(join(packageRoot, artifact))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  return { root, packageRoot, launcher: join(packageRoot, "bin", "omo.js"), agentDir }
}

function run(fixture: Fixture, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [fixture.launcher, "doctor"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OMO_CODING_AGENT_DIR: fixture.agentDir,
      SENPI_CODING_AGENT_DIR: fixture.agentDir,
      OMO_RUNTIME: "node",
      ...env,
    },
  })
}

function captureDoctor(options: Record<string, unknown> = {}): { stdout: string; exitCode: number | undefined } {
  const output: string[] = []
  const originalLog = console.log
  const originalExitCode = process.exitCode
  console.log = (value?: unknown) => { output.push(String(value)) }
  process.exitCode = undefined
  try {
    runDoctor({ harnesses: [] }, [], {
      list: () => [],
      ...options,
    })
    return { stdout: output.join("\n"), exitCode: process.exitCode }
  } finally {
    console.log = originalLog
    process.exitCode = originalExitCode ?? 0
  }
}

function editionLine(stdout: string): string {
  const line = stdout.split("\n").find((entry) => entry.startsWith("INFO omo · Edition:"))
  if (line === undefined) throw new Error(`missing edition line in:\n${stdout}`)
  return line
}

function lineAfter(stdout: string, line: string): string {
  const lines = stdout.split("\n")
  const index = lines.indexOf(line)
  if (index < 0 || index + 1 >= lines.length) throw new Error(`no line after ${JSON.stringify(line)} in:\n${stdout}`)
  return lines[index + 1] ?? ""
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo doctor edition summary", () => {
  describe("#given a complete packaged installation", () => {
    describe("#when diagnostics run", () => {
      test("#then the summary names Native edition, the installed version with engine, and Latest", () => {
        const distTags = { beta: "5.0.0-0.beta.99", latest: "4.9.0" }
        const captured = captureDoctor({ fetchDistTags: () => distTags })
        const version = packageManifest().version
        const expectedLatest = latestFromDistTags(distTags, version)

        expect(editionLine(captured.stdout)).toMatch(
          new RegExp(`^INFO omo · Edition: Native · Installed: ${version.replaceAll(".", "\\.")} \\(engine: senpi .+\\) · Latest: ${expectedLatest.replaceAll(".", "\\.")}$`),
        )
      })

      test("#then the update command is the next line and is copyable on its own", () => {
        const captured = captureDoctor({ fetchDistTags: () => ({ beta: "5.0.0-0.beta.99", latest: "4.9.0" }) })
        const summary = editionLine(captured.stdout)
        expect(lineAfter(captured.stdout, summary)).toBe(`INFO Update: ${updateTarget().command}`)
      })
    })
  })

  describe("#given bun versus npm install layouts", () => {
    test("#then an npm-managed install prints the npm update command", () => {
      const fixture = createFixture("npm")
      const result = run(fixture)
      expect(result.status).toBe(0)
      const summary = editionLine(result.stdout)
      expect(summary).toMatch(/^INFO omo · Edition: Native · Installed: 5\.0\.0-0\.beta\.51 \(engine: senpi 2026\.8\.9\) · Latest: /)
      expect(lineAfter(result.stdout, summary)).toBe("INFO Update: npm i -g omo-ai@beta")
      expect(updateTarget(fixture.packageRoot).command).toBe("npm i -g omo-ai@beta")
    })

    test("#then a Bun-managed install prints the bun update command for that layout", () => {
      const fixture = createFixture("bun")
      const result = run(fixture)
      expect(result.status).toBe(0)
      const summary = editionLine(result.stdout)
      expect(lineAfter(result.stdout, summary)).toBe(`INFO Update: ${updateTarget(fixture.packageRoot).command}`)
      expect(updateTarget(fixture.packageRoot).manager).toBe("bun")
    })
  })

  describe("#given the installed channel", () => {
    test("#then a beta install reads the beta dist-tag", () => {
      expect(latestFromDistTags({ beta: "5.0.0-0.beta.99", latest: "4.9.0" }, "5.0.0-0.beta.51")).toBe("5.0.0-0.beta.99")
    })

    test("#then a stable install reads the latest dist-tag", () => {
      expect(latestFromDistTags({ beta: "5.0.0-0.beta.99", latest: "4.9.0" }, "5.0.0")).toBe("4.9.0")
    })
  })

  describe("#given the registry cannot be reached", () => {
    test("#then Latest is could not check and diagnostics still pass", () => {
      const captured = captureDoctor({
        fetchDistTags: () => {
          throw new Error("ECONNREFUSED")
        },
      })
      expect(editionLine(captured.stdout)).toContain("· Latest: could not check")
      expect(captured.stdout).not.toMatch(/FAIL[^\n]*(latest|registry|npm|dist-tag)/i)
    })

    test("#then a refused registry fetch returns no dist-tags", () => {
      const tags = fetchNpmDistTagsSync({
        spawn: () => ({ status: 1, stdout: "", stderr: "ECONNREFUSED" }),
      })
      expect(tags).toBeNull()
      expect(latestFromDistTags(tags, "5.0.0-0.beta.51")).toBe("could not check")
    })
  })

  describe("#given the npm registry answers", () => {
    test("#then dist-tags are read from registry.npmjs.org with a bounded timeout", () => {
      const calls: Array<{ cmd: string; args: string[]; opts: { timeout?: number } }> = []
      const tags = fetchNpmDistTagsSync({
        spawn: (cmd: string, args: string[], opts: { timeout?: number }) => {
          calls.push({ cmd, args, opts })
          return { status: 0, stdout: JSON.stringify({ beta: "5.0.0-0.beta.99", latest: "4.9.0" }), stderr: "" }
        },
      })

      expect(tags).toEqual({ beta: "5.0.0-0.beta.99", latest: "4.9.0" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.cmd).toBe(process.execPath)
      expect(calls[0]?.args[0]).toBe("-e")
      expect(calls[0]?.args[1]).toContain("registry.npmjs.org")
      expect(calls[0]?.args[1]).toContain("omo-ai")
      expect(calls[0]?.args[1]).toContain("dist-tags")
      expect(calls[0]?.opts.timeout).toBeGreaterThan(0)
      expect(calls[0]?.opts.timeout).toBeLessThanOrEqual(10_000)
    })
  })
})
