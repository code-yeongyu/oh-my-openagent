import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []
const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
] as const

type Fixture = { root: string; packageRoot: string; launcher: string; agentDir: string }

function writeFile(path: string, content = "fixture\n"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-doctor-"))
  roots.push(root)
  const packageRoot = join(root, "app")
  mkdirSync(packageRoot, { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "1.2.3-test.0",
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
    env: { ...process.env, SENPI_CODING_AGENT_DIR: fixture.agentDir, ...env },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo doctor", () => {
  describe("#given a complete packaged installation", () => {
    describe("#when diagnostics run", () => {
      test("#then every required check passes", () => {
        const fixture = createFixture()
        const result = run(fixture)
        expect(result.status).toBe(0)
        for (const [label] of artifacts) expect(result.stdout).toContain(`PASS ${label}`)
        expect(result.stdout).toContain("PASS senpi CLI")
        expect(result.stdout).toContain("PASS senpi version 2026.8.9")
        expect(result.stdout).not.toContain("FAIL")
      })
    })
  })

  describe("#given a required packaged artifact is missing", () => {
    for (const [label, artifact] of artifacts) {
      test(`#then missing ${label} fails diagnostics and names the path`, () => {
        const fixture = createFixture()
        rmSync(join(fixture.packageRoot, artifact))
        const result = run(fixture)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(`FAIL ${label}`)
        expect(result.stdout).toContain(artifact)
      })
    }
  })

  describe("#given the installed senpi version differs from the packaged pin", () => {
    test("#then the version check fails with both versions", () => {
      const fixture = createFixture()
      const manifestPath = join(fixture.packageRoot, "node_modules", "@code-yeongyu", "senpi", "package.json")
      writeFile(manifestPath, JSON.stringify({
        name: "@code-yeongyu/senpi",
        version: "2026.8.8",
        type: "module",
        exports: { ".": "./dist/index.js" },
      }))
      const result = run(fixture)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain("FAIL senpi version")
      expect(result.stdout).toContain("expected 2026.8.9, found 2026.8.8")
    })
  })

  describe("#given settings contain the legacy package entry", () => {
    for (const [shape, entry] of [
      ["string", "@code-yeongyu/omo-senpi"],
      ["object", { source: "@code-yeongyu/omo-senpi", enabled: true }],
    ] as const) {
      test(`#then the ${shape} shape warns without changing settings`, () => {
        const fixture = createFixture()
        const settingsPath = join(fixture.agentDir, "settings.json")
        const original = `${JSON.stringify({ packages: [entry] }, null, 2)}\n`
        writeFile(settingsPath, original)
        const result = run(fixture)
        expect(result.status).toBe(0)
        expect(result.stdout).toContain("WARN duplicate @code-yeongyu/omo-senpi")
        expect(result.stdout).toContain("remove it from the packages array")
        expect(readFileSync(settingsPath, "utf8")).toBe(original)
      })
    }
  })

  describe("#given settings JSON is malformed", () => {
    test("#then diagnostics warn and continue without changing settings", () => {
      const fixture = createFixture()
      const settingsPath = join(fixture.agentDir, "settings.json")
      const original = "{ not-json\n"
      writeFile(settingsPath, original)
      const result = run(fixture)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("WARN could not parse")
      expect(readFileSync(settingsPath, "utf8")).toBe(original)
    })
  })

  describe("#given SENPI_CODING_AGENT_DIR points to an alternate agent directory", () => {
    test("#then doctor reads settings from that directory first", () => {
      const fixture = createFixture()
      const alternate = join(fixture.root, "alternate-agent")
      writeFile(join(alternate, "settings.json"), JSON.stringify({ packages: ["@code-yeongyu/omo-senpi"] }))
      const result = run(fixture, { SENPI_CODING_AGENT_DIR: alternate })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("WARN duplicate @code-yeongyu/omo-senpi")
    })
  })
})

function envWithoutAgentDir(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home }
  delete env.OMO_CODING_AGENT_DIR
  delete env.SENPI_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  return env
}

describe("omo doctor", () => {
  describe("#given no agent directory is configured", () => {
    describe("#when diagnostics run", () => {
      test("#then the canonical branded directory is the one inspected", () => {
        const fixture = createFixture()
        const home = join(fixture.root, "home")
        writeFile(
          join(home, ".omo", "agent", "settings.json"),
          JSON.stringify({ packages: ["@code-yeongyu/omo-senpi"] }),
        )

        const result = spawnSync(process.execPath, [fixture.launcher, "doctor"], {
          encoding: "utf8",
          env: envWithoutAgentDir(home),
        })

        expect(result.stdout).toContain("WARN duplicate @code-yeongyu/omo-senpi package entry")
      })
    })
  })
})
