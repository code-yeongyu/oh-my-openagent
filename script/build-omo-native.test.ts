// Contract tests for the prebuilt-input guarantee of the omo-native plugin build.
// Regression: publish-platform installs with --ignore-scripts, so beta.32 run
// 33586966744 hit ENOENT on packages/lsp-daemon/dist in every platform leg.

import { describe, expect, test } from "bun:test"
import { sep } from "node:path"

import { ensurePrebuiltNativeInputs, type PrebuiltInputDependencies } from "./build-omo-native"

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
  test("#given both prebuilt artifacts present #when ensuring #then no root build script runs", () => {
    // given
    const { dependencies, probed, built } = recordingDependencies({
      existing: ["packages/lsp-daemon/dist", "packages/ast-grep-mcp/dist/cli.js"],
    })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual([])
    expect(probed.some((path) => path.endsWith(["packages", "lsp-daemon", "dist"].join(sep)))).toBe(true)
    expect(probed.some((path) => path.endsWith(["packages", "ast-grep-mcp", "dist", "cli.js"].join(sep)))).toBe(true)
  })

  test("#given no prebuilt artifacts #when ensuring #then each input builds via its root script in order", () => {
    // given
    const { dependencies, built } = recordingDependencies({ existing: [] })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual(["build:lsp-daemon", "build:ast-grep-mcp"])
  })

  test("#given only the daemon dist missing #when ensuring #then only build:lsp-daemon runs", () => {
    // given
    const { dependencies, built } = recordingDependencies({
      existing: ["packages/ast-grep-mcp/dist/cli.js"],
    })

    // when
    ensurePrebuiltNativeInputs(dependencies)

    // then
    expect(built).toEqual(["build:lsp-daemon"])
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
