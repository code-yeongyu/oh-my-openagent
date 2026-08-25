/// <reference types="bun-types" />

import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The verifier pins the runtime artifacts that omo-ai must ship. `plugin/runtime/dag/sdk.js` is
 * load-bearing: the mass-ulw skill imports it through OMO_DAG_SDK_ROOT, so a packaging change that
 * drops it must fail the gate instead of shipping a skill that documents a dead import.
 *
 * The verifier resolves its package directory from its own location, so the guard is exercised by
 * copying it into a throwaway repo skeleton whose packages/omo-native manifest declares exactly the
 * payload under test.
 */
const verifierSource = fileURLToPath(new URL("./verify-omo-ai-payload.mjs", import.meta.url))
const guardTimeoutMs = 120_000

setDefaultTimeout(guardTimeoutMs)

const PACKED_ARTIFACTS = [
  "bin/omo.js",
  "bin/omo-agent-toolkit.js",
  "plugin/package.json",
  "plugin/extensions/omo.js",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/agent-toolkit/cli.js",
  "plugin/runtime/agent-toolkit/ulw-loop/cli.js",
  "plugin/runtime/agent-toolkit/omo-agent-toolkit",
  "plugin/runtime/agent-toolkit/omo-agent-toolkit.cmd",
  "plugin/runtime/dag/sdk.js",
] as const

const PACKED_SKILL_COUNT = 23

interface VerifierRun {
  readonly exitCode: number
  readonly output: string
}

function writeFixtureFile(packageDir: string, relativePath: string, content: string): void {
  const target = join(packageDir, relativePath)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content, "utf8")
}

function runVerifierOnPayload(payloadPaths: readonly string[]): VerifierRun {
  const fakeRepoRoot = mkdtempSync(join(tmpdir(), "omo-ai-payload-guard-"))
  try {
    mkdirSync(join(fakeRepoRoot, "script"), { recursive: true })
    copyFileSync(verifierSource, join(fakeRepoRoot, "script", "verify-omo-ai-payload.mjs"))

    const packageDir = join(fakeRepoRoot, "packages", "omo-native")
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        { name: "omo-ai-payload-guard-fixture", version: "0.0.0", private: false, files: ["bin", "plugin"] },
        null,
        2,
      )}\n`,
      "utf8",
    )
    for (const relativePath of payloadPaths) {
      writeFixtureFile(packageDir, relativePath, "// fixture\n")
    }

    const result = spawnSync(
      process.execPath,
      [join(fakeRepoRoot, "script", "verify-omo-ai-payload.mjs")],
      { cwd: fakeRepoRoot, encoding: "utf8", timeout: guardTimeoutMs },
    )
    return {
      exitCode: result.status ?? 1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    }
  } finally {
    rmSync(fakeRepoRoot, { recursive: true, force: true })
  }
}

function skillPaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `plugin/skills/fixture-skill-${index}/SKILL.md`)
}

describe("omo-ai payload verifier", () => {
  describe("#given a packed payload whose only gap is the dag eval sdk", () => {
    describe("#when the verifier runs", () => {
      test("#then it fails naming plugin/runtime/dag/sdk.js as a missing artifact", () => {
        // given
        const payload = [
          ...PACKED_ARTIFACTS.filter((path) => path !== "plugin/runtime/dag/sdk.js"),
          ...skillPaths(PACKED_SKILL_COUNT),
        ]

        // when
        const run = runVerifierOnPayload(payload)

        // then
        expect(run.output).toContain("missing artifact: plugin/runtime/dag/sdk.js")
        expect(run.exitCode).toBe(1)
      })
    })
  })

  describe("#given a packed payload carrying every pinned artifact", () => {
    describe("#when the verifier runs", () => {
      test("#then it passes with no missing-artifact error", () => {
        // given
        const payload = [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)]

        // when
        const run = runVerifierOnPayload(payload)

        // then
        expect(run.output).not.toContain("missing artifact:")
        expect(run.exitCode).toBe(0)
      })
    })
  })
})
