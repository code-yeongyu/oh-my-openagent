import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { findOmoPathEntries } from "../bin/lib/stale-bin.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []
const artifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
] as const

type Fixture = {
  root: string
  packageRoot: string
  launcher: string
  agentDir: string
  npmBinDir: string
  npmOmo: string
  legacyDir: string
  legacyOmo: string
}

function writeFile(path: string, content = "fixture\n", mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, mode === undefined ? undefined : { mode })
}

function commandName(): string {
  return process.platform === "win32" ? "omo.cmd" : "omo"
}

/**
 * A stand-in for the legacy managed wrapper left behind by an older OMO install. It answers
 * --version with a fixed old version so the doctor probe has something stale to report; a null
 * version stubs a wrapper whose --version fails.
 */
function writeLegacyStub(dir: string, version: string | null): string {
  mkdirSync(dir, { recursive: true })
  const stub = join(dir, commandName())
  if (process.platform === "win32") {
    writeFile(stub, version === null ? "@echo off\r\nexit /b 1\r\n" : `@echo off\r\necho ${version}\r\n`)
  } else {
    // The shebang pins the running interpreter so the stub resolves without any system PATH.
    const body = version === null
      ? `#!${process.execPath}\nprocess.exit(1)\n`
      : `#!${process.execPath}\nif (process.argv[2] === "--version") console.log(${JSON.stringify(version)})\n`
    writeFile(stub, body)
    chmodSync(stub, 0o755)
  }
  return stub
}

function createFixture(options: { legacyVersion?: string | null } = {}): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-stale-bin-")))
  roots.push(root)
  const packagePath = join(root, "prefix", "lib", "node_modules", "omo-ai")
  mkdirSync(packagePath, { recursive: true })
  const packageRoot = realpathSync(packagePath)
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai",
    version: "5.0.0-0.beta.test",
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
  for (const [, artifact] of artifacts) writeFile(join(packageRoot, artifact))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })

  // The upgraded install is reached the way npm reaches it: an omo link in the global bin
  // directory pointing back into the package tree.
  const npmBinDir = join(root, "prefix", "bin")
  mkdirSync(npmBinDir, { recursive: true })
  const npmOmo = join(npmBinDir, commandName())
  if (process.platform === "win32") {
    writeFile(npmOmo, `@echo off\r\nnode "${join(packageRoot, "bin", "omo.js")}" %*\r\n`)
  } else {
    symlinkSync(join(packageRoot, "bin", "omo.js"), npmOmo)
  }

  const legacyDir = join(root, "home", ".local", "bin")
  const legacyOmo = writeLegacyStub(legacyDir, options.legacyVersion === undefined ? "4.19.4" : options.legacyVersion)
  return { root, packageRoot, launcher: join(packageRoot, "bin", "omo.js"), agentDir, npmBinDir, npmOmo, legacyDir, legacyOmo }
}

function run(fixture: Fixture, pathEnv: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [fixture.launcher, "doctor"], {
    encoding: "utf8",
    env: { ...process.env, SENPI_CODING_AGENT_DIR: fixture.agentDir, PATH: pathEnv },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("stale omo binary detection", () => {
  describe("findOmoPathEntries", () => {
    describe("#given a PATH containing missing directories and duplicates", () => {
      test("#then existing omo commands are returned in PATH order without duplicates", () => {
        const fixture = createFixture()
        const first = join(fixture.root, "first")
        writeFile(join(first, commandName()), "stub\n", 0o755)
        const entries = findOmoPathEntries(
          [fixture.npmBinDir, first, "/does-not-exist", fixture.npmBinDir].join(delimiter),
        )
        expect(entries).toEqual([fixture.npmOmo, join(first, commandName())])
      })
    })

    describe("#given an empty PATH", () => {
      test("#then no entries are collected", () => {
        expect(findOmoPathEntries("")).toEqual([])
      })
    })

    test.skipIf(process.platform === "win32")(
      "#given a non-executable file named omo #when entries are collected #then it is skipped",
      () => {
        const fixture = createFixture()
        const dir = join(fixture.root, "not-executable")
        writeFile(join(dir, "omo"), "not executable\n", 0o644)
        expect(findOmoPathEntries(dir)).toEqual([])
      },
    )
  })

  describe("omo doctor stale-binary diagnostics", () => {
    describe("#given a legacy wrapper earlier on PATH than the upgraded install", () => {
      test("#then doctor names the stale binary, its version, and the cache-clear recipe without failing", () => {
        const fixture = createFixture()
        const result = run(fixture, [fixture.legacyDir, fixture.npmBinDir].join(delimiter))
        expect(result.status).toBe(0)
        const stdout = String(result.stdout)
        expect(stdout).toContain("WARN")
        expect(stdout).toContain(fixture.legacyOmo)
        expect(stdout).toContain("4.19.4")
        expect(stdout).toContain("hash -r")
        expect(stdout).toContain("rehash")
        expect(stdout).toContain('export PATH="$(npm prefix -g)/bin:$PATH"')
      })
    })

    describe("#given the upgraded install precedes a leftover legacy copy on PATH", () => {
      test("#then doctor warns that shells may keep starting the cached old binary", () => {
        const fixture = createFixture()
        const result = run(fixture, [fixture.npmBinDir, fixture.legacyDir].join(delimiter))
        expect(result.status).toBe(0)
        const stdout = String(result.stdout)
        expect(stdout).toContain("WARN")
        expect(stdout).toContain(fixture.legacyOmo)
        expect(stdout).toContain("hash -r")
        expect(stdout).toContain("rehash")
      })
    })

    describe("#given only the upgraded install on PATH", () => {
      test("#then doctor emits no stale-binary warnings", () => {
        const fixture = createFixture()
        const result = run(fixture, fixture.npmBinDir)
        expect(result.status).toBe(0)
        const stdout = String(result.stdout)
        expect(stdout).not.toContain("hash -r")
        expect(stdout).not.toContain("stale omo")
      })
    })

    describe("#given a foreign omo whose --version fails", () => {
      test("#then it is still reported as an unknown-version copy and doctor stays green", () => {
        const fixture = createFixture({ legacyVersion: null })
        const result = run(fixture, [fixture.legacyDir, fixture.npmBinDir].join(delimiter))
        expect(result.status).toBe(0)
        const stdout = String(result.stdout)
        expect(stdout).toContain(fixture.legacyOmo)
        expect(stdout).toContain("unknown version")
      })
    })
  })
})
