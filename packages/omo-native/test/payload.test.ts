import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, test } from "bun:test"

/**
 * Integration coverage for script/build-omo-native.ts. The completeness gate
 * must fail closed on empty staging and pass only when the staged payload
 * carries every required plugin artifact with executable modes intact and no
 * plugin-local dev clutter.
 */
const repoRoot = resolve(import.meta.dir, "..", "..", "..")
const buildScript = join(repoRoot, "script", "build-omo-native.ts")
const fullBuildTimeoutMs = 15 * 60 * 1000
const tempDirs: string[] = []

interface BuildResult {
  readonly exitCode: number
  readonly output: string
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-native-payload-"))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function runBuild(args: readonly string[]): BuildResult {
  const result = spawnSync(process.execPath, [buildScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: fullBuildTimeoutMs,
  })
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  }
}

function listRelativeFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    return entry.isDirectory() ? listRelativeFiles(root, relative) : [relative]
  })
}

describe("build:omo-native staged payload", () => {
  describe("#given an empty staging directory", () => {
    describe("#when the completeness check runs", () => {
      test("#then it exits 1 naming the first missing artifact", () => {
        const outputDir = join(makeTempDir(), "plugin")
        const result = runBuild(["--output", outputDir, "--check-only"])
        expect(result.exitCode).toBe(1)
        expect(result.output).toContain(`missing required artifact: ${join("extensions", "omo.js")}`)
      })
    })
  })

  describe("#given a full plugin build", () => {
    describe("#when the payload is staged to a temp output dir", () => {
      test(
        "#then every required artifact is present with preserved modes and no dev clutter",
        () => {
          const outputDir = join(makeTempDir(), "plugin")
          const result = runBuild(["--output", outputDir])
          expect(result.exitCode, `build failed:\n${result.output.slice(-2000)}`).toBe(0)

          const required = [
            join("extensions", "omo.js"),
            join("extensions", "reflection-persona.md"),
            join("extensions", "dream-persona.md"),
            join("extensions", "facts-persona.md"),
            join("runtime", "ast-grep-mcp", "cli.js"),
            join("runtime", "agent-toolkit", "cli.js"),
            join("runtime", "agent-toolkit", "ulw-loop", "cli.js"),
            join("runtime", "agent-toolkit", "omo-agent-toolkit"),
            join("runtime", "agent-toolkit", "omo-agent-toolkit.cmd"),
            join("runtime", "agent-toolkit", "directive.md"),
            join("runtime", "lsp-daemon", "dist", "cli.js"),
            join("scripts", "install.mjs"),
            "package.json",
          ]
          for (const artifact of required) {
            expect(existsSync(join(outputDir, artifact))).toBe(true)
          }

          const manifest = JSON.parse(readFileSync(join(outputDir, "package.json"), "utf8")) as {
            name?: string
          }
          expect(manifest.name).toBe("@code-yeongyu/omo-senpi")

          // Windows has no POSIX execute bit, so stat reports 0o666 there regardless of the staged mode.
          if (process.platform !== "win32") {
            const shimMode =
              statSync(join(outputDir, "runtime", "agent-toolkit", "omo-agent-toolkit")).mode & 0o777
            expect(shimMode).toBe(0o755)
          }

          const skillCount = readdirSync(join(outputDir, "skills"), {
            withFileTypes: true,
          }).filter(
            (entry) =>
              entry.isDirectory() && existsSync(join(outputDir, "skills", entry.name, "SKILL.md")),
          ).length
          expect(skillCount).toBeGreaterThanOrEqual(18)

          const files = listRelativeFiles(outputDir)
          expect(files.filter((file) => file.includes(".test."))).toEqual([])
          expect(files.filter((file) => file.split("/").includes("node_modules"))).toEqual([])
          expect(files.filter((file) => file.startsWith("scripts/"))).toEqual([
            "scripts/install.mjs",
          ])

          expect(
            readFileSync(join(repoRoot, "packages", "omo-native", ".gitignore"), "utf8").replaceAll(
              "\r\n",
              "\n",
            ),
          ).toBe("/plugin/\n")

          rmSync(join(outputDir, "extensions", "dream-persona.md"))
          const missingPersona = runBuild(["--output", outputDir, "--check-only"])
          expect(missingPersona.exitCode).toBe(1)
          expect(missingPersona.output).toContain(
            `missing required artifact: ${join("extensions", "dream-persona.md")}`,
          )
        },
        fullBuildTimeoutMs,
      )
    })
  })
})

/**
 * The product is branded omo. Skills inside the payload legitimately mention the senpi engine
 * they document, but nothing shipped from this repository may claim to BE senpi: that is the
 * identity the branded install replaces.
 */
const IDENTITY_CLAIM = /\b(?:you are|i am)\s+senpi\b/i
const MAX_SCANNED_BYTES = 2 * 1024 * 1024

function stagedPluginRoot(): string | undefined {
  const root = join(repoRoot, "packages", "omo-native", "plugin")
  return existsSync(root) ? root : undefined
}

function scannableFiles(root: string): string[] {
  return listRelativeFiles(root)
    .filter((relative) => !relative.startsWith("runtime/"))
    .filter((relative) => statSync(join(root, relative)).size <= MAX_SCANNED_BYTES)
}

describe("staged payload harness identity", () => {
  describe("#given the staged omo-ai payload", () => {
    describe("#when every shipped text file is scanned", () => {
      test("#then no file claims to be the senpi harness", () => {
        const root = stagedPluginRoot()
        if (root === undefined) {
          expect(existsSync(join(repoRoot, "packages", "omo-native"))).toBe(true)
          return
        }

        const offenders = scannableFiles(root).filter((relative) => {
          let content: string
          try {
            content = readFileSync(join(root, relative), "utf8")
          } catch {
            return false
          }
          return IDENTITY_CLAIM.test(content)
        })

        expect(offenders).toEqual([])
      })

      test("#then the guard actually detects an identity claim", () => {
        expect(IDENTITY_CLAIM.test("You are senpi, a coding agent.")).toBe(true)
        expect(IDENTITY_CLAIM.test("i am senpi")).toBe(true)
        expect(IDENTITY_CLAIM.test("senpi is the engine this skill documents")).toBe(false)
      })
    })
  })
})
