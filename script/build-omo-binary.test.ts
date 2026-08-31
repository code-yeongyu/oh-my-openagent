// script/build-omo-binary.test.ts
// Contract tests for the per-target compiled omo release binaries.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertBinarySizeBudget,
  assertEngineGraphBundled,
  EMBEDDED_PAYLOAD_ROOT,
  ENGINE_MINIMUM_MODULES,
  MAX_BINARY_BYTES,
  parseBundledModuleCount,
  RELEASE_BINARY_TARGETS,
  buildRuntimeManifest,
  collectStagedFiles,
  createStampedPackageJson,
  embeddedNameForRelPath,
  relPathForEmbeddedName,
  reportEmbeddedPayload,
  resolveExpectedSidecarRelPaths,
  RUNTIME_MANIFEST_REL_PATH,
  stageSidecarPayload,
} from "./build-omo-binary"
import ptyFixture from "./release-binary-pty-fixture.json"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe("RELEASE_BINARY_TARGETS", () => {
  test("#given the release target map #when inspected #then it lists the twelve published targets", () => {
    // given
    const expected = [
      "darwin-arm64",
      "darwin-x64",
      "darwin-x64-baseline",
      "linux-x64",
      "linux-x64-baseline",
      "linux-arm64",
      "linux-x64-musl",
      "linux-x64-musl-baseline",
      "linux-arm64-musl",
      "windows-x64",
      "windows-x64-baseline",
      "windows-arm64",
    ]

    // when
    const targets = RELEASE_BINARY_TARGETS.map((entry) => entry.target)

    // then
    expect(RELEASE_BINARY_TARGETS).toHaveLength(12)
    expect(targets.slice().sort()).toEqual(expected.slice().sort())
  })

  test("#given the windows-arm64 target #when inspected #then it compiles for TRUE arm64, not x64 emulation", () => {
    // given
    const windowsArm64 = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "windows-arm64")

    // when
    const bunTarget = windowsArm64?.bunTarget

    // then
    expect(bunTarget).toBe("bun-windows-arm64")
  })

  test("#given every non-windows-arm64 target #when inspected #then the bun target is bun-<target>", () => {
    // given
    const others = RELEASE_BINARY_TARGETS.filter((entry) => entry.target !== "windows-arm64")

    // when
    const mismatched = others.filter((entry) => entry.bunTarget !== `bun-${entry.target}`)

    // then
    expect(mismatched).toEqual([])
  })

  test("#given windows targets #when inspected #then the output binary carries the .exe suffix", () => {
    // given
    const windowsTargets = RELEASE_BINARY_TARGETS.filter((entry) => entry.os === "windows")
    const posixTargets = RELEASE_BINARY_TARGETS.filter((entry) => entry.os !== "windows")

    // when
    const windowsNames = windowsTargets.map((entry) => entry.binaryName)
    const posixNames = posixTargets.map((entry) => entry.binaryName)

    // then
    expect(windowsNames).toEqual(windowsTargets.map((entry) => `omo-${entry.target}.exe`))
    expect(posixNames).toEqual(posixTargets.map((entry) => `omo-${entry.target}`))
  })

  test("#given the pty expectation fixture #when compared to the target map #then every target has an entry", () => {
    // given
    const fixtureTargets = Object.keys(ptyFixture.targets)

    // when
    const mapTargets = RELEASE_BINARY_TARGETS.map((entry) => entry.target)

    // then
    expect(fixtureTargets.slice().sort()).toEqual(mapTargets.slice().sort())
    expect(ptyFixture.ptyPin).toBe(RELEASE_BINARY_TARGETS[0]!.ptyPin)
  })

  test("#given the pty fixture #when a target is marked available #then it names the prebuild host directory", () => {
    // given
    const entries = Object.entries(ptyFixture.targets)

    // when
    const available = entries.filter(([, value]) => value.ptyAvailable)
    const absent = entries.filter(([, value]) => !value.ptyAvailable)

    // then
    expect(available.every(([, value]) => typeof value.prebuildHost === "string")).toBe(true)
    expect(absent.every(([, value]) => value.prebuildHost === null)).toBe(true)
    expect(available.map(([name]) => name)).toContain("darwin-arm64")
  })
})

describe("embedded asset naming", () => {
  test("#given a sidecar relative path #when embedded and read back #then the round trip is lossless", () => {
    // given
    const relPaths = [
      "package.json",
      "theme/dark.json",
      "node_modules/@code-yeongyu/senpi-codemode/package.json",
      "plugin/skills/ast-grep/SKILL.md",
      "native/prebuilds/darwin-arm64/senpi_pty.darwin-arm64.node",
    ]

    // when
    const roundTripped = relPaths.map((relPath) =>
      relPathForEmbeddedName(embeddedNameForRelPath(relPath)),
    )

    // then
    expect(roundTripped).toEqual(relPaths)
    expect(embeddedNameForRelPath("theme/dark.json")).toBe(`${EMBEDDED_PAYLOAD_ROOT}/theme/dark.json`)
  })

  test("#given an embedded name outside the payload root #when mapped #then it is rejected as non-payload", () => {
    // given
    const foreign = "some-other-root/theme/dark.json"

    // when
    const mapped = relPathForEmbeddedName(foreign)

    // then
    expect(mapped).toBeUndefined()
  })
})

describe("stamped package.json", () => {
  test("#given an omo-ai version #when the sidecar package.json is stamped #then name and version match the contract", () => {
    // given
    const omoAiVersion = "9.9.9-0.test"

    // when
    const stamped = JSON.parse(createStampedPackageJson(omoAiVersion)) as Record<string, unknown>

    // then
    expect(stamped.name).toBe("omo")
    expect(stamped.version).toBe(omoAiVersion)
  })
})

describe("runtime manifest", () => {
  test("#given a staged payload #when the manifest is built #then every file has relPath, sha256, mode and size", async () => {
    // given
    const stageDir = makeTempDir("omo-manifest-")
    mkdirSync(join(stageDir, "theme"), { recursive: true })
    writeFileSync(join(stageDir, "theme", "dark.json"), "{}\n", "utf8")
    writeFileSync(join(stageDir, "package.json"), createStampedPackageJson("1.2.3"), "utf8")

    // when
    const manifest = await buildRuntimeManifest(stageDir, {
      omoAiVersion: "1.2.3",
      enginePin: "2026.8.24",
    })

    // then
    expect(manifest.omoAiVersion).toBe("1.2.3")
    expect(manifest.enginePin).toBe("2026.8.24")
    expect(manifest.manifestSha).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.entries.map((entry) => entry.relPath).sort()).toEqual([
      "package.json",
      "theme/dark.json",
    ])
    for (const entry of manifest.entries) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.size).toBeGreaterThan(0)
      expect(typeof entry.mode).toBe("number")
    }
    rmSync(stageDir, { recursive: true, force: true })
  })

  test("#given the same payload staged twice #when manifests are built #then manifestSha is deterministic", async () => {
    // given
    const first = makeTempDir("omo-manifest-a-")
    const second = makeTempDir("omo-manifest-b-")
    for (const dir of [first, second]) {
      mkdirSync(join(dir, "theme"), { recursive: true })
      writeFileSync(join(dir, "theme", "dark.json"), "{}\n", "utf8")
    }

    // when
    const options = { omoAiVersion: "1.2.3", enginePin: "2026.8.24" }
    const manifestA = await buildRuntimeManifest(first, options)
    const manifestB = await buildRuntimeManifest(second, options)

    // then
    expect(manifestA.manifestSha).toBe(manifestB.manifestSha)
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  })
})

describe("size budget", () => {
  test("#given a synthetic oversize binary #when the budget is enforced #then it fails loud naming the target", () => {
    // given
    const stageDir = makeTempDir("omo-size-")
    const binaryPath = join(stageDir, "omo-darwin-arm64")
    writeFileSync(binaryPath, "x", "utf8")

    // when
    const oversize = (): void => {
      assertBinarySizeBudget("darwin-arm64", binaryPath, { maxBytes: 0 })
    }
    const withinBudget = (): void => {
      assertBinarySizeBudget("darwin-arm64", binaryPath)
    }

    // then
    expect(oversize).toThrow(/darwin-arm64/)
    expect(withinBudget).not.toThrow()
    expect(MAX_BINARY_BYTES).toBe(150 * 1024 * 1024)
    rmSync(stageDir, { recursive: true, force: true })
  })
})

describe("sidecar parity set", () => {
  test("#given the host target #when the expected sidecar set is resolved #then it unions engine assets, plugin payload, pty and the stamped package.json", () => {
    // given
    const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "darwin-arm64")
    expect(target).toBeDefined()

    // when
    const relPaths = resolveExpectedSidecarRelPaths(target!)

    // then
    expect(relPaths).toContain("package.json")
    expect(relPaths).toContain("theme/dark.json")
    expect(relPaths).toContain("assets/clankolas.png")
    expect(relPaths).toContain("export-html/template.html")
    expect(relPaths).toContain("export-html/vendor/marked.min.js")
    expect(relPaths).toContain("photon_rs_bg.wasm")
    expect(relPaths.some((relPath) => relPath.startsWith("docs/"))).toBe(true)
    expect(relPaths.some((relPath) => relPath.startsWith("examples/"))).toBe(true)
    expect(relPaths.some((relPath) => relPath.startsWith("vendor/"))).toBe(true)
    expect(relPaths.some((relPath) => relPath.startsWith("node_modules/css-tree/"))).toBe(true)
    expect(relPaths.some((relPath) => relPath.startsWith("node_modules/mdn-data/"))).toBe(true)
    expect(relPaths.some((relPath) => relPath.startsWith("node_modules/source-map-js/"))).toBe(true)
    expect(relPaths).toContain("node_modules/@code-yeongyu/senpi-codemode/package.json")
    expect(relPaths).toContain("plugin/extensions/omo.js")
    expect(relPaths).toContain("plugin/skills/ast-grep/SKILL.md")
    expect(relPaths).toContain("native/prebuilds/darwin-arm64/senpi_pty.darwin-arm64.node")
  })

  test("#given a pty-absent target #when the expected sidecar set is resolved #then no pty prebuild is required", () => {
    // given
    const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "linux-x64")
    expect(target).toBeDefined()

    // when
    const relPaths = resolveExpectedSidecarRelPaths(target!)

    // then
    expect(relPaths.some((relPath) => relPath.startsWith("native/prebuilds/"))).toBe(false)
    expect(relPaths).toContain("package.json")
  })
})

describe("embedded manifest parity (darwin-arm64)", () => {
  const builtBinary = join(repoRoot, ".omo", "release-binaries", "omo-darwin-arm64")

  test(
    "#given the darwin-arm64 sidecar payload #when embedded and probed #then the embedded set equals the expected parity set",
    async () => {
      // given
      const target = RELEASE_BINARY_TARGETS.find((entry) => entry.target === "darwin-arm64")!
      const stageRoot = makeTempDir("omo-parity-")
      const stageDir = join(stageRoot, "omo-runtime")
      stageSidecarPayload(target, stageDir, "0.0.0-0.test")
      const manifest = await buildRuntimeManifest(stageDir, {
        omoAiVersion: "0.0.0-0.test",
        enginePin: target.enginePin,
      })
      writeFileSync(
        join(stageDir, RUNTIME_MANIFEST_REL_PATH),
        `${JSON.stringify(manifest)}\n`,
        "utf8",
      )

      // when
      const embedded = reportEmbeddedPayload(stageDir)

      // then
      const embeddedRelPaths = embedded.relPaths
        .filter((relPath) => relPath !== RUNTIME_MANIFEST_REL_PATH)
        .slice()
        .sort()
      expect(embeddedRelPaths).toEqual(resolveExpectedSidecarRelPaths(target).slice().sort())
      expect(embedded.manifest.enginePin).toBe(target.enginePin)
      expect(embedded.manifest.omoAiVersion).toBe("0.0.0-0.test")
      rmSync(stageRoot, { recursive: true, force: true })
    },
    900_000,
  )

  test.skipIf(!existsSync(builtBinary))(
    "#given the built darwin-arm64 binary #when measured #then it stays within the 150MB budget",
    () => {
      // given / when
      const size = statSync(builtBinary).size

      // then
      expect(size).toBeLessThanOrEqual(MAX_BINARY_BYTES)
    },
  )
})

describe("plugin staging isolation guard", () => {
  test("#given build-omo-native --output outside the package #when it runs #then packages/omo-native stays porcelain-clean", () => {
    // given
    const stageDir = makeTempDir("omo-plugin-stage-")
    const before = spawnSync("git", ["status", "--porcelain", "--", "packages/omo-native"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout

    // when
    const built = spawnSync(
      "bun",
      ["run", "script/build-omo-native.ts", "--output", join(stageDir, "plugin")],
      { cwd: repoRoot, encoding: "utf8" },
    )

    // then
    expect(built.status).toBe(0)
    const after = spawnSync("git", ["status", "--porcelain", "--", "packages/omo-native"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout
    expect(after).toBe(before)
    expect(existsSync(join(stageDir, "plugin", "extensions", "omo.js"))).toBe(true)
    const staged = collectStagedFiles(join(stageDir, "plugin"))
    expect(staged.length).toBeGreaterThan(0)
    rmSync(stageDir, { recursive: true, force: true })
  }, 600_000)
})

describe("engine graph bundling", () => {
  test("#given real bun build output #when parsed #then the module count is extracted", () => {
    // given
    const output = "\n [447ms]  bundle  3995 modules\n\n [132ms]  compile  /tmp/x\n"

    // when / then
    expect(parseBundledModuleCount(output)).toBe(3995)
    expect(assertEngineGraphBundled(output)).toBe(3995)
  })

  test("#given output without a module-count line #when asserted #then the build fails loud rather than guessing", () => {
    // given
    const output = "\n [132ms]  compile  /tmp/x\n"

    // when / then
    expect(parseBundledModuleCount(output)).toBeUndefined()
    expect(() => assertEngineGraphBundled(output)).toThrow(/could not read the bundled module count/)
  })

  test("#given an engine-less bundle #when asserted #then it fails naming the literal-import requirement", () => {
    // given - a launcher-only graph, as produced when the entry's import loses
    // static traceability through a const indirection or runtime-resolved URL
    const output = "\n   [4ms]  bundle  7 modules\n"

    // when / then
    expect(() => assertEngineGraphBundled(output)).toThrow(
      /engine graph is missing.*inline string literal/s,
    )
  })

  test("#given the engine floor #when compared to both observed shapes #then it separates them", () => {
    // given - measured: engine-bundled ≈ 4001 modules, launcher-only ≈ 7
    // when / then
    expect(ENGINE_MINIMUM_MODULES).toBeLessThan(4001)
    expect(ENGINE_MINIMUM_MODULES).toBeGreaterThan(7)
  })
})

describe("staged file collection", () => {
  test("#given a nested stage directory #when collected #then relative POSIX paths are returned sorted", () => {
    // given
    const stageDir = makeTempDir("omo-collect-")
    mkdirSync(join(stageDir, "b", "c"), { recursive: true })
    writeFileSync(join(stageDir, "b", "c", "two.txt"), "2", "utf8")
    writeFileSync(join(stageDir, "a.txt"), "1", "utf8")

    // when
    const collected = collectStagedFiles(stageDir)

    // then
    expect(collected).toEqual(["a.txt", "b/c/two.txt"])
    expect(readdirSync(stageDir).length).toBe(2)
    rmSync(stageDir, { recursive: true, force: true })
  })
})
