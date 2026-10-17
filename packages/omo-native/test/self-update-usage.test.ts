import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runSelfUpdate } from "../bin/lib/self-update.js"

// Asking for help or mistyping a flag must never replace the install (#9207); only the bare
// command and its documented `--self` spelling install.

type Harness = {
  code: number
  spawned: unknown[]
  lookups: number
  lines: string[]
  errors: string[]
}

async function selfUpdate(args: string[]): Promise<Harness> {
  const spawned: unknown[] = []
  const lines: string[] = []
  const errors: string[] = []
  let lookups = 0
  const code = await runSelfUpdate(args, {
    resolveUpdate: () => ({ manager: "npm", command: "npm i -g omo-ai@1.0.1", argv: ["npm", "i", "-g", "omo-ai@1.0.1"] }),
    fetchDistTags: () => {
      lookups += 1
      return { latest: "1.0.1" }
    },
    readInstalled: () => ({ omo: spawned.length === 0 ? "1.0.0" : "1.0.1", engine: "2026.9.29" }),
    run: async (...call: unknown[]) => {
      spawned.push(call)
      return { status: 0, signal: null }
    },
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  })
  return { code, spawned, lookups, lines, errors }
}

describe("omo update argument handling", () => {
  for (const flag of ["--help", "-h"]) {
    test(`#given update ${flag} #then it prints the update usage, exits 0 and installs nothing`, async () => {
      const result = await selfUpdate(["update", flag])
      expect(result.code).toBe(0)
      expect(result.spawned).toEqual([])
      expect(result.lookups).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.lines[0]).toStartWith("Usage: omo update")
    })
  }

  test("#given help next to another flag #then help wins and nothing is installed", async () => {
    const result = await selfUpdate(["update", "--dry-run", "-h"])
    expect(result.code).toBe(0)
    expect(result.spawned).toEqual([])
    expect(result.lines[0]).toStartWith("Usage: omo update")
  })

  for (const flag of ["--forse", "-x", "--"]) {
    test(`#given the unknown flag ${flag} #then it is a usage error naming the flag and installs nothing`, async () => {
      const result = await selfUpdate(["update", flag])
      expect(result.code).toBe(2)
      expect(result.spawned).toEqual([])
      expect(result.lookups).toBe(0)
      expect(result.lines).toEqual([])
      expect(result.errors.join("\n")).toContain(flag === "--" ? "option --" : flag)
    })
  }

  test("#given an unknown flag after a print-only flag #then it is still a usage error", async () => {
    const result = await selfUpdate(["update", "--dry-run", "--forse"])
    expect(result.code).toBe(2)
    expect(result.spawned).toEqual([])
    expect(result.lines).toEqual([])
  })

  describe("#regression the existing spellings keep their behavior", () => {
    for (const args of [["update"], ["update", "--self"], ["update", "self"], ["update", "senpi"], ["update", "omo"]]) {
      test(`#given ${args.join(" ")} #then it installs the resolved target once`, async () => {
        const result = await selfUpdate(args)
        expect(result.code).toBe(0)
        expect(result.spawned).toEqual([["npm", ["i", "-g", "omo-ai@1.0.1"], expect.objectContaining({ stdio: "inherit" })]])
        expect(result.lines).toEqual(["omo is updated via npm: npm i -g omo-ai@1.0.1", "omo 1.0.0 -> 1.0.1 (engine: senpi 2026.9.29)"])
      })
    }

    for (const args of [["update", "--dry-run"], ["update", "--print"], ["update", "--self", "--print"]]) {
      test(`#given ${args.join(" ")} #then it prints the command and installs nothing`, async () => {
        const result = await selfUpdate(args)
        expect(result.code).toBe(0)
        expect(result.spawned).toEqual([])
        expect(result.lines).toEqual(["omo is updated via npm: npm i -g omo-ai@1.0.1"])
      })
    }
  })
})

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * A copy of the real launcher whose engine and package-manager spawns both record into one capture
 * file, so any route that would start the engine or run an install leaves evidence behind.
 */
function launcherFixture(): { root: string; launcher: string; captureFile: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-update-usage-")))
  roots.push(root)
  const packageRoot = join(root, "prefix", "lib", "node_modules", "omo-ai")
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
  writeFile(join(senpiRoot, "dist", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "engine", argv: process.argv.slice(2) }))
`)
  writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  writeFile(join(packageRoot, "bin", "lib", "npm-dist-tags.js"), `
export function fetchNpmDistTagsSync() {
  return { beta: "1.2.3-test.1" }
}
`)
  writeFile(join(packageRoot, "bin", "lib", "child-process.js"), `
import { writeFileSync } from "node:fs"
export function propagateResult() {}
export async function spawnNode(cliPath, args) {
  writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "engine", argv: args }))
}
export async function runChild(command, args) {
  writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "install", command, args }))
  return { status: 0, signal: null }
}
`)
  return { root, launcher: join(packageRoot, "bin", "omo.js"), captureFile: join(root, "capture.json") }
}

function launch(fixture: ReturnType<typeof launcherFixture>, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: "/usr/bin:/bin", HOME: join(fixture.root, "home"), CAPTURE_FILE: fixture.captureFile }
  delete env.OMO_CODING_AGENT_DIR
  delete env.SENPI_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  return spawnSync(process.execPath, [fixture.launcher, ...args], { encoding: "utf8", env })
}

describe("omo launcher update routing", () => {
  for (const flag of ["--help", "-h"]) {
    test(`#given omo update ${flag} #then the launcher prints usage and neither installs nor starts the engine`, () => {
      const fixture = launcherFixture()
      const result = launch(fixture, ["update", flag])
      expect(result.status).toBe(0)
      expect(result.stdout).toStartWith("Usage: omo update")
      expect(existsSync(fixture.captureFile)).toBe(false)
    })
  }

  test("#given omo update with an unknown flag #then the launcher exits 2 naming it and installs nothing", () => {
    const fixture = launcherFixture()
    const result = launch(fixture, ["update", "--forse"])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("--forse")
    expect(existsSync(fixture.captureFile)).toBe(false)
  })

  test("#given plain omo update #then the launcher still runs the pinned install", () => {
    const fixture = launcherFixture()
    const result = launch(fixture, ["update"])
    expect(JSON.parse(readFileSync(fixture.captureFile, "utf8"))).toEqual({
      target: "install",
      command: "npm",
      args: ["i", "-g", "omo-ai@1.2.3-test.1"],
    })
    // The fake manager leaves the version unchanged, so the post-install check reports it; the
    // install still ran, which is what this routing case is about.
    expect(result.status).toBe(1)
  })

  test("#given omo update --extensions #then the engine still owns it", () => {
    const fixture = launcherFixture()
    const result = launch(fixture, ["update", "--extensions"])
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(fixture.captureFile, "utf8"))).toEqual({ target: "engine", argv: ["update", "--extensions"] })
  })
})
