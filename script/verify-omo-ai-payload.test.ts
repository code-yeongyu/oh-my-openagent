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
const npmInvocationSource = fileURLToPath(new URL("./npm-invocation.mjs", import.meta.url))
const guardTimeoutMs = 120_000

setDefaultTimeout(guardTimeoutMs)

const PACKED_ARTIFACTS = [
  "bin/omo.js",
  "plugin/package.json",
  "plugin/CHANGELOG.md",
  "plugin/extensions/omo.js",
  "plugin/skills-conditional/x-search/SKILL.md",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/dag/sdk.js",
  "plugin/runtime/agent-toolkit-sdk/sdk.js",
  "plugin/runtime/thread-sdk/sdk.js",
  "plugin/runtime/category-coverage/index.js",
  "plugin/runtime/category-coverage/assets.generated.json",
  "plugin/runtime/task-config/index.js",
] as const

const CATEGORY_COVERAGE_BUNDLE = "plugin/runtime/category-coverage/index.js"
const CATEGORY_COVERAGE_ASSET = "plugin/runtime/category-coverage/assets.generated.json"
// The unminified read the 5.1.1 category-coverage bundle carries.
const BUNDLED_SIBLING_READ =
  'ASSETS_JSON_PATH=join3(dirname3(fileURLToPath2(import.meta.url)),"assets.generated.json");\n'
// The terser-minified shape of the same read in plugin/extensions/*.js.
const MINIFIED_SIBLING_READ = 'const a=t(i(o(import.meta.url)),"assets.generated.json");\n'

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

function runVerifierOnPayload(
  payloadPaths: readonly string[],
  contents: Readonly<Record<string, string>> = {},
): VerifierRun {
  const fakeRepoRoot = mkdtempSync(join(tmpdir(), "omo-ai-payload-guard-"))
  try {
    mkdirSync(join(fakeRepoRoot, "script"), { recursive: true })
    copyFileSync(verifierSource, join(fakeRepoRoot, "script", "verify-omo-ai-payload.mjs"))
    copyFileSync(npmInvocationSource, join(fakeRepoRoot, "script", "npm-invocation.mjs"))

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
      writeFixtureFile(packageDir, relativePath, contents[relativePath] ?? "// fixture\n")
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
  test("#given a payload missing only the agent toolkit SDK #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([...PACKED_ARTIFACTS.filter(path => path !== "plugin/runtime/agent-toolkit-sdk/sdk.js"), ...skillPaths(PACKED_SKILL_COUNT)])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: plugin/runtime/agent-toolkit-sdk/sdk.js")
  })

  test("#given a payload missing only the omo daemon task-config runtime #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([...PACKED_ARTIFACTS.filter(path => path !== "plugin/runtime/task-config/index.js"), ...skillPaths(PACKED_SKILL_COUNT)])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: plugin/runtime/task-config/index.js")
  })

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

  describe("#given the 5.1.1 layout: the category-coverage bundle reads a sibling asset only extensions/ ships", () => {
    test("#then it fails naming the unpacked sibling asset", () => {
      const payload = [
        ...PACKED_ARTIFACTS.filter((path) => path !== CATEGORY_COVERAGE_ASSET),
        "plugin/extensions/assets.generated.json",
        ...skillPaths(PACKED_SKILL_COUNT),
      ]

      const run = runVerifierOnPayload(payload, { [CATEGORY_COVERAGE_BUNDLE]: BUNDLED_SIBLING_READ })

      expect(run.output).toContain(
        `missing sibling asset: ${CATEGORY_COVERAGE_BUNDLE} reads ${CATEGORY_COVERAGE_ASSET}, which is not packed`,
      )
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given any packed bundle that reads a sibling file the payload does not ship", () => {
    test("#then the sibling-asset rule fails on its own, beyond the pinned artifact list", () => {
      const bundle = "plugin/runtime/dag/library.js"
      const payload = [...PACKED_ARTIFACTS, bundle, ...skillPaths(PACKED_SKILL_COUNT)]

      const run = runVerifierOnPayload(payload, { [bundle]: MINIFIED_SIBLING_READ.replace("assets.generated.json", "library-data.json") })

      expect(run.output).not.toContain("missing artifact:")
      expect(run.output).toContain(`missing sibling asset: ${bundle} reads plugin/runtime/dag/library-data.json, which is not packed`)
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given every sibling-asset reader ships its asset beside it", () => {
    test("#then both the bundled and the minified read shapes pass", () => {
      const payload = [
        ...PACKED_ARTIFACTS,
        "plugin/extensions/omo-computer-use.js",
        "plugin/extensions/assets.generated.json",
        ...skillPaths(PACKED_SKILL_COUNT),
      ]

      const run = runVerifierOnPayload(payload, {
        [CATEGORY_COVERAGE_BUNDLE]: BUNDLED_SIBLING_READ,
        "plugin/extensions/omo-computer-use.js": MINIFIED_SIBLING_READ,
      })

      expect(run.output).not.toContain("missing sibling asset:")
      expect(run.exitCode).toBe(0)
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
