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
          expect(result.exitCode).toBe(0)

          const required = [
            join("extensions", "omo.js"),
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

          expect(readFileSync(join(repoRoot, "packages", "omo-native", ".gitignore"), "utf8")).toBe(
            "/plugin/\n",
          )
        },
        fullBuildTimeoutMs,
      )
    })
  })
})
