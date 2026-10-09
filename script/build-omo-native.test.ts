// Contract tests for the prebuilt-input guarantee of the omo-native plugin build.
// Regression: publish-platform installs with --ignore-scripts, so beta.32 run
// 33586966744 hit ENOENT on packages/lsp-daemon/dist in every platform leg.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { PERSONA_ASSET_FILES } from "@oh-my-opencode/memory-core/personas"

import {
  ensurePrebuiltNativeInputs,
  NATIVE_REQUIRED_ARTIFACTS,
  PAYLOAD_DIRECTORIES,
  PAYLOAD_FILES,
  PAYLOAD_SCRIPT,
  REQUIRED_PLUGIN_ARTIFACTS,
  type PrebuiltInputDependencies,
} from "./build-omo-native"

describe("runtime persona coverage", () => {
  test("#given the runtime persona manifest #when the payload requirements are read #then every persona is required", () => {
    // given
    const required = new Set<string>(REQUIRED_PLUGIN_ARTIFACTS)

    // when
    const unguarded = PERSONA_ASSET_FILES.filter((filename) => !required.has(join("extensions", filename)))

    // then
    expect(unguarded).toEqual([])
  })
})

function recordingDependencies(input: {
  readonly existing: readonly string[]
  readonly scriptStatus?: number
  readonly scriptError?: Error
}): { readonly dependencies: PrebuiltInputDependencies; readonly probed: string[]; readonly built: string[] } {
  const probed: string[] = []
  const built: string[] = []
  const dependencies: PrebuiltInputDependencies = {
    artifactExists: (absolutePath) => {
      probed.push(absolutePath)
      return input.existing.some((suffix) => absolutePath.endsWith(suffix.split("/").join(sep)))
    },
    runRootScript: (script) => {
      built.push(script)
      return { error: input.scriptError, status: input.scriptStatus ?? 0 }
    },
  }
  return { dependencies, probed, built }
}

describe("ensurePrebuiltNativeInputs", () => {
  const omowrightRuntime = ["packages", "shared-skills", "skills", "browser", "runtime", "omowright", "index.js"].join(sep)

  test("#given every prebuilt artifact present #when ensuring #then no root build script runs", () => {
    // given
    const { dependencies, probed, built } = recordingDependencies({
      existing: ["packages/lsp-daemon/dist", "packages/ast-grep-mcp/dist/cli.js", omowrightRuntime],
    })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual([])
    expect(probed.some((path) => path.endsWith(["packages", "lsp-daemon", "dist"].join(sep)))).toBe(true)
    expect(probed.some((path) => path.endsWith(["packages", "ast-grep-mcp", "dist", "cli.js"].join(sep)))).toBe(true)
    expect(probed.some((path) => path.endsWith(omowrightRuntime))).toBe(true)
  })

  test("#given no prebuilt artifacts #when ensuring #then each input builds via its root script in order", () => {
    // given
    const { dependencies, built } = recordingDependencies({ existing: [] })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual(["build:lsp-daemon", "build:ast-grep-mcp", "build:materialize-frontend"])
  })

  test("#given only the daemon dist missing #when ensuring #then only build:lsp-daemon runs", () => {
    // given
    const { dependencies, built } = recordingDependencies({
      existing: ["packages/ast-grep-mcp/dist/cli.js", omowrightRuntime],
    })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual(["build:lsp-daemon"])
  })

  // Regression (issue #9661): the binary release pipeline runs the native staging chain with
  // OMO_SKIP_MATERIALIZE=1, so stage-omowright-runtime.mjs never ran and the published binary's
  // browser skill had no runtime. Only the omowright runtime missing must trigger its staging.
  test("#given only the omowright runtime missing #when ensuring #then only build:materialize-frontend runs", () => {
    // given
    const { dependencies, built } = recordingDependencies({
      existing: ["packages/lsp-daemon/dist", "packages/ast-grep-mcp/dist/cli.js"],
    })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual(["build:materialize-frontend"])
  })

  test("#given a root build script exits nonzero #when ensuring #then the exit code surfaces", () => {
    // given
    const { dependencies } = recordingDependencies({ existing: [], scriptStatus: 7 })

    // when / then
    expect(() => ensurePrebuiltNativeInputs(dependencies)).toThrow(
      "build:lsp-daemon failed with exit code 7",
    )
  })

  test("#given the spawn itself errors #when ensuring #then the error propagates", () => {
    // given
    const spawnError = new Error("spawn bun ENOENT")
    const { dependencies } = recordingDependencies({ existing: [], scriptError: spawnError })

    // when / then
    expect(() => ensurePrebuiltNativeInputs(dependencies)).toThrow("spawn bun ENOENT")
  })
})

// Regression: skills-conditional was in the plugin `files` allowlist but not in the payload copy
// lists, so every published omo-ai shipped without the staged x-search SKILL.md and senpi warned
// "skill path does not exist" at startup.
describe("plugin payload allowlist parity", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const pluginFiles: readonly string[] = JSON.parse(
    readFileSync(join(repoRoot, "packages", "omo-senpi", "plugin", "package.json"), "utf8"),
  ).files

  test("#given the plugin files allowlist #when compared with the payload lists #then every published entry is copied", () => {
    // given
    const copied = new Set<string>([
      ...PAYLOAD_DIRECTORIES,
      ...PAYLOAD_FILES,
      PAYLOAD_SCRIPT.split(sep).join("/"),
    ])

    // when
    const uncopied = pluginFiles.filter((entry) => !copied.has(entry))

    // then
    expect(uncopied).toEqual([])
  })

  test("#given the daemon launch spec #when checking the payload #then it is both copied and required", () => {
    // The spec is a root-level plugin file, so the directory copies never reach it; it has to be on
    // the root-file list to be copied and on the required list so a payload without it fails the
    // build instead of shipping an `omo daemon run` that exits 5.
    expect(PAYLOAD_FILES).toContain("daemon-launch-spec.json")
    expect(REQUIRED_PLUGIN_ARTIFACTS).toContain("daemon-launch-spec.json")
  })

  test("#given the conditional x-search skill #when checking the payload #then it is both copied and required", () => {
    // when / then
    expect(PAYLOAD_DIRECTORIES).toContain("skills-conditional")
    expect(REQUIRED_PLUGIN_ARTIFACTS).toContain(join("skills-conditional", "x-search", "SKILL.md"))
  })

  // Regression (issue #9661): the browser skill's bundled omowright runtime is staged into the
  // payload and must be required, or a binary built without it ships a browser skill that always
  // fails to load omowright.
  test("#given the browser skill omowright runtime #when checking the payload #then it is required", () => {
    expect(REQUIRED_PLUGIN_ARTIFACTS).toContain(join("skills", "browser", "runtime", "omowright", "index.js"))
    expect(REQUIRED_PLUGIN_ARTIFACTS).toContain(join("skills", "browser", "runtime", "omowright", "page-bundle.js"))
  })
})

describe("payload completeness gate", () => {
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "build-omo-native.ts")
  const pageBundle = join("skills", "browser", "runtime", "omowright", "page-bundle.js")

  function stagedPayload(): string {
    const root = mkdtempSync(join(tmpdir(), "omo-native-gate-"))
    for (const artifact of NATIVE_REQUIRED_ARTIFACTS) {
      mkdirSync(dirname(join(root, artifact)), { recursive: true })
      writeFileSync(join(root, artifact), "staged\n")
    }
    return root
  }

  function checkOnly(outputDir: string) {
    return spawnSync("bun", [scriptPath, "--check-only", "--output", outputDir], { encoding: "utf8" })
  }

  // Regression (issue #9661): the bundled omowright index.js reads page-bundle.js beside itself at
  // import time, so a payload that carries index.js without it ships the same broken browser skill.
  test("#given a staged payload missing only the omowright page bundle #when the completeness gate runs #then it fails naming that file", () => {
    // given
    const root = stagedPayload()
    try {
      rmSync(join(root, pageBundle))

      // when
      const result = checkOnly(root)

      // then
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`missing required artifact: ${pageBundle}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a complete staged payload #when the completeness gate runs #then it passes", () => {
    // given
    const root = stagedPayload()
    try {
      // when
      const result = checkOnly(root)

      // then
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
