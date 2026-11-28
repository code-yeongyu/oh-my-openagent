import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join, relative, sep } from "node:path"

import { PERSONA_ASSET_FILES } from "@oh-my-opencode/memory-core/personas"

import {
  COMPUTER_PRELUDE_ASSET_NAME,
  COMPUTER_RUN_WASM_NAME,
  extensionBuildPaths,
  MEMORY_SYNC_ASSET_NAMES,
} from "./build-extension-core.mjs"
import { BUNDLE_INPUTS_PATH } from "./bundle-inputs.mjs"

const repoRoot = join(import.meta.dir, "..", "..", "..", "..")

// The installer `build-install.mjs` writes; its module keeps the path private, so the table and the
// output census share this one constant instead of the test re-deriving the generator's wiring.
const INSTALL_CLI_OUTPUT = "packages/omo-senpi/plugin/scripts/install.mjs"
// The installer `script/build-codex-install.ts` writes (it chmods the output 0o755 itself).
const CODEX_INSTALLER_OUTPUT = "packages/omo-codex/scripts/install-dist/install-local.mjs"

// The recorded intent for the git index mode of every tracked output the bundle recipe owns.
// A container regeneration diffs a tree copy, and `bun build` marks a shebang entry executable on
// disk, so a mode-only flip is exactly the kind of change a content-only freshness gate lets
// through (#12394). Every entry records WHY the mode is what it is; a tracked output with no entry
// falls back to the non-executable default and can only become executable by joining this table.
const DEFAULT_GENERATED_OUTPUT_MODE = "100644"
const EXPECTED_OUTPUT_MODES = {
  // The installer's source entry (`src/install/cli-local.ts`) carries `#!/usr/bin/env bun`, and
  // `bun build` marks a shebang entry executable on disk (0755 under the default umask): that is
  // how #12257's regen commit 1eb97bd0ea flipped the tracked mode. Every caller runs the installer
  // through an interpreter (`bun`/`node <path>`; the omo-native payload stages it the same way),
  // `build-install.mjs` never chmods its output, and the file was 100644 for its whole tracked
  // history before that regen, so the executable bit was never intended here.
  [INSTALL_CLI_OUTPUT]: "100644",
  // Node-shebang supervisor spawned by the memory runner and hooks as `<execPath> <script>`: the
  // executable bit is deliberate convention (never load-bearing, every spawn names the runtime),
  // tracked 100755 through every regeneration since it landed.
  "packages/omo-senpi/plugin/extensions/memory-run-supervisor.mjs": "100755",
  // `script/build-codex-install.ts` chmods its output 0o755 by design: the Codex installer is a
  // directly runnable program.
  [CODEX_INSTALLER_OUTPUT]: "100755",
}

/** One line per drifted output, so a failure names the file and both modes. */
function describeModeViolation(violation) {
  return `${violation.output}: index ${violation.trackedMode}, recorded ${violation.expectedMode}`
}

/**
 * Pure: recipe outputs + index modes + recorded table -> mode-only drift. Untracked outputs
 * (gitignored staged runtimes) have no index entry, so there is no tracked mode to guard.
 */
function generatedOutputModeViolations(outputs, indexModes, expectedModes) {
  const violations = []
  for (const output of outputs) {
    const trackedMode = indexModes.get(output)
    if (trackedMode === undefined) continue
    const expectedMode = expectedModes[output] ?? DEFAULT_GENERATED_OUTPUT_MODE
    if (expectedMode !== trackedMode) violations.push({ output, expectedMode, trackedMode })
  }
  return violations
}

/** Pure: recorded entries whose output is no longer produced or no longer tracked, so the table cannot rot. */
function staleExpectedModeEntries(outputs, indexModes, expectedModes) {
  return Object.keys(expectedModes).filter((path) => !outputs.includes(path) || indexModes.get(path) === undefined)
}

/** The git index mode of every tracked file, read from `git ls-files -s` (the index, never the disk). */
function readGitIndexModes(root) {
  // The full listing of a 14k-file tree is ~1.5 MB, past spawnSync's 1 MB default buffer.
  const result = spawnSync("git", ["ls-files", "-s"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`git ls-files -s exited ${result.status}: ${result.stderr}`)
  const modes = new Map()
  for (const line of result.stdout.split("\n")) {
    const match = /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/.exec(line)
    if (match !== null) modes.set(match[2], match[1])
  }
  return modes
}

/**
 * The generated outputs the bundle recipe owns, reused from the generators: the extension build's
 * own output map, the assets it stages beside the bundles, the two installers and the traced
 * bundle-inputs map. Never a hand-kept copy of the bundle list.
 */
function generatedOutputsInRepo() {
  const outputs = new Set([INSTALL_CLI_OUTPUT, CODEX_INSTALLER_OUTPUT, BUNDLE_INPUTS_PATH])
  for (const [key, value] of Object.entries(extensionBuildPaths)) {
    if (/outputPath$/i.test(key)) outputs.add(relative(repoRoot, value).split(sep).join("/"))
  }
  const extensionsDir = relative(repoRoot, join(extensionBuildPaths.pluginRoot, "extensions")).split(sep).join("/")
  for (const asset of [...MEMORY_SYNC_ASSET_NAMES, COMPUTER_PRELUDE_ASSET_NAME, COMPUTER_RUN_WASM_NAME]) {
    outputs.add(`${extensionsDir}/${asset}`)
  }
  for (const persona of PERSONA_ASSET_FILES) outputs.add(`${extensionsDir}/${persona}`)
  return [...outputs].filter((path) => !path.startsWith("..")).sort()
}

describe("generatedOutputModeViolations", () => {
  describe("#given tracked recipe outputs and the recorded mode table", () => {
    describe("#when a tracked output's index mode differs from the recorded one", () => {
      test("#then the mode-only flip is reported with both modes", () => {
        const indexModes = new Map([
          ["a/installer.mjs", "100755"],
          ["a/bundle.js", "100644"],
        ])
        const violations = generatedOutputModeViolations(
          ["a/installer.mjs", "a/bundle.js", "a/untracked-runtime.js"],
          indexModes,
          { "a/installer.mjs": "100644" },
        )
        expect(violations).toEqual([{ output: "a/installer.mjs", expectedMode: "100644", trackedMode: "100755" }])
      })
    })

    describe("#when a tracked output has no recorded entry", () => {
      test("#then it falls back to the non-executable default, so a flipped bundle cannot dodge the table", () => {
        const violations = generatedOutputModeViolations(["a/bundle.js"], new Map([["a/bundle.js", "100755"]]), {})
        expect(violations).toEqual([{ output: "a/bundle.js", expectedMode: "100644", trackedMode: "100755" }])
      })
    })
  })
})

describe("staleExpectedModeEntries", () => {
  describe("#given a recorded entry whose output left the recipe or the index", () => {
    describe("#when the table is checked against the outputs and the index", () => {
      test("#then the stale entry is reported instead of silently guarding nothing", () => {
        const stale = staleExpectedModeEntries(["a/bundle.js"], new Map([["a/bundle.js", "100644"]]), {
          "a/bundle.js": "100644",
          "a/gone.mjs": "100755",
        })
        expect(stale).toEqual(["a/gone.mjs"])
      })
    })
  })
})

describe("generated output index modes", () => {
  describe("#given the tracked outputs of the bundle recipe", () => {
    describe("#when the recorded mode table is applied to the git index", () => {
      test("#then every tracked generated output keeps its recorded mode", () => {
        // extensionBuildPaths honours OMO_SENPI_PLUGIN_OUTPUT at import time, which would steer the
        // census outside the repository and hollow out the guard; fail loudly instead.
        if (process.env.OMO_SENPI_PLUGIN_OUTPUT !== undefined) {
          throw new Error("unset OMO_SENPI_PLUGIN_OUTPUT before running generated-file-modes")
        }
        const outputs = generatedOutputsInRepo()
        const indexModes = readGitIndexModes(repoRoot)
        const violations = generatedOutputModeViolations(outputs, indexModes, EXPECTED_OUTPUT_MODES)
        expect(violations.map(describeModeViolation)).toEqual([])
        const stale = staleExpectedModeEntries(outputs, indexModes, EXPECTED_OUTPUT_MODES)
        expect(stale).toEqual([])
      })
    })
  })
})
