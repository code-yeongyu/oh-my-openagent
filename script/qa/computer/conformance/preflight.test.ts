import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Environment, repoPath } from "./preflight.ts"

const runScript = join(import.meta.dir, "run.ts")

function withDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "conformance-preflight-"))
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function run(dir: string, engine: string) {
  const out = join(dir, "out")
  const child = Bun.spawnSync(["bun", runScript, "--os", "fake", "--all", "--engine", engine, "--out", out])
  const environment: Environment = JSON.parse(readFileSync(join(out, "environment.json"), "utf8"))
  return {
    stdout: child.stdout.toString(),
    exitCode: child.exitCode,
    environment,
    ranCells: existsSync(join(out, "run.json")),
  }
}

describe("environment preflight [ADP-3]", () => {
  test("a prerequisite path is printed with forward slashes, so the same run reads identically on every OS", () => {
    expect(repoPath("/repo", "/repo/script\\qa\\computer\\conformance\\drivers\\legacy.ts")).toBe(
      "script/qa/computer/conformance/drivers/legacy.ts",
    )
    expect(repoPath("/repo", "/repo/script/qa/computer/conformance/drivers/engine.ts")).toBe(
      "script/qa/computer/conformance/drivers/engine.ts",
    )
  })

  test("a missing engine ends the run as ENVIRONMENT_ERROR before any cell, never as a smaller green matrix", () => {
    withDir((dir) => {
      const result = run(dir, join(dir, "no-such-engine"))
      expect(result.exitCode).toBe(3)
      expect(result.stdout).toContain("ENVIRONMENT_ERROR engine-binary:")
      expect(result.stdout).not.toContain("CATALOG ")
      expect(result.ranCells).toBe(false)
      expect(result.environment.status).toBe("ENVIRONMENT_ERROR")
      expect(result.environment.checks.filter((check) => !check.ok).map((check) => check.name)).toContain(
        "engine-binary",
      )
    })
  })

  test("an ENVIRONMENT_ERROR in a reused output directory leaves no earlier run.json beside its record", () => {
    withDir((dir) => {
      mkdirSync(join(dir, "out"))
      writeFileSync(join(dir, "out", "run.json"), "{}")
      const result = run(dir, join(dir, "no-such-engine"))
      expect(result.exitCode).toBe(3)
      expect(result.ranCells).toBe(false)
    })
  })

  test("a driver is loaded from drivers/<name>.ts, and a missing driver file is named as the missing prerequisite", () => {
    withDir((dir) => {
      const out = join(dir, "out")
      const child = Bun.spawnSync(["bun", runScript, "--os", "fake", "--all", "--driver", "legacy", "--out", out])
      expect(child.exitCode).toBe(3)
      expect(child.stdout.toString()).toContain(
        "ENVIRONMENT_ERROR driver-legacy: script/qa/computer/conformance/drivers/legacy.ts is not present",
      )
    })
  })

  test("an engine that answers engine.hello on the fake backend passes the stdio probe", () => {
    withDir((dir) => {
      // A real executable on every OS: a one-line Bun script compiled for this host.
      const source = join(dir, "engine.ts")
      writeFileSync(
        source,
        `for await (const _ of console) {\n  console.log('{"jsonrpc":"2.0","id":1,"result":{}}')\n  break\n}\n`,
      )
      const engine = join(dir, process.platform === "win32" ? "engine.exe" : "engine")
      const built = Bun.spawnSync(["bun", "build", "--compile", source, "--outfile", engine])
      expect(built.exitCode, built.stderr.toString()).toBe(0)
      const { environment } = run(dir, engine)
      expect(environment.checks.find((check) => check.name === "engine-stdio")?.ok).toBe(true)
      expect(environment.checks.find((check) => check.name === "engine-binary")?.ok).toBe(true)
    })
  }, 60_000)
})
