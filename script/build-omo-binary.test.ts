// script/build-omo-binary.test.ts
// Contract tests for the per-target compiled omo release binaries.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  PLUGIN_PAYLOAD_DIRECTORIES,
  PLUGIN_PAYLOAD_FILES,
  RELEASE_BINARY_TARGETS,
  buildRuntimeManifest,
  collectStagedFiles,
  createStampedPackageJson,
  embeddedNameForRelPath,
  relPathForEmbeddedName,
  reportEmbeddedPayload,
  resolveExpectedSidecarRelPaths,
  RUNTIME_MANIFEST_REL_PATH,
} from "./build-omo-binary"
import { PAYLOAD_DIRECTORIES, PAYLOAD_FILES } from "./build-omo-native"
import * as binaryBuilder from "./build-omo-binary"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function stageParityFixture(stageDir: string, relPaths: readonly string[]): void {
  for (const relPath of relPaths) {
    const filePath = join(stageDir, ...relPath.split("/"))
    mkdirSync(dirname(filePath), { recursive: true })
    const contents = relPath.endsWith("runtime-manifest.json") ? "{}\n" : `fixture:${relPath}\n`
    writeFileSync(filePath, contents, "utf8")
  }
}

const GREP_HOSTS: Readonly<Record<string, string | null>> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "darwin-x64-baseline": "darwin-x64",
  "linux-x64": "linux-x64",
  "linux-x64-baseline": "linux-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64-musl": null,
  "linux-x64-musl-baseline": null,
  "linux-arm64-musl": null,
  "windows-x64": "win32-x64",
  "windows-x64-baseline": "win32-x64",
  "windows-arm64": "win32-arm64",
}

function nativeFixture() {
  return {
    $comment: "Native prebuild test fixture",
    generatedAt: "2026-09-14",
    prebuilds: {
      senpi_pty: {
        packageName: "@code-yeongyu/senpi-pty",
        pinSource: "ptyPin",
        pin: "2026.8.24",
        targets: Object.fromEntries(Object.keys(GREP_HOSTS).map((target) => [target, {
          available: target === "darwin-arm64",
          prebuildHost: target === "darwin-arm64" ? target : null,
        }])),
      },
      senpi_grep: {
        packageName: "@code-yeongyu/senpi",
        pinSource: "enginePin",
        targets: Object.fromEntries(Object.entries(GREP_HOSTS).map(([target, prebuildHost]) => [target, {
          available: false,
          prebuildHost,
        }])),
      },
    },
  }
}

function runStagingCommand(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stdout}\n${result.stderr}`)
}

// Replace only the registry boundary: the fallback still finds and extracts a real tarball.
function packedPrebuildDependencies(packageDir: string, archiveRoot: string, packageSpec: string) {
  const commands: string[] = []
  return {
    commands,
    resolvePackageDir: () => packageDir,
    runCommand(command: string, args: readonly string[], cwd: string): void {
      commands.push(command)
      if (command === "npm") {
        expect(args).toEqual(["pack", packageSpec])
        runStagingCommand("tar", ["czf", join(cwd, "fixture.tgz"), "-C", archiveRoot, "package"], cwd)
      } else {
        runStagingCommand(command, args, cwd)
      }
    },
  }
}

const unexpectedPack = (): never => { throw new Error("local prebuild must not invoke npm pack") }

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

  test("#given the native fixture on disk #when loaded #then every package covers all targets without changing either pin", () => {
    const fixture = JSON.parse(
      readFileSync(join(scriptDir, "release-binary-native-fixture.json"), "utf8"),
    ) as ReturnType<typeof nativeFixture>
    expect(fixture.prebuilds).toEqual(nativeFixture().prebuilds)
    const nativePackage = JSON.parse(readFileSync(join(repoRoot, "packages/omo-native/package.json"), "utf8"))
    expect(binaryBuilder.loadReleaseBinaryTargets(fixture)).toEqual(RELEASE_BINARY_TARGETS)
    expect(RELEASE_BINARY_TARGETS.every((target) => target.enginePin === nativePackage.dependencies["@code-yeongyu/senpi"])).toBe(true)
    for (const prebuild of Object.values(fixture.prebuilds)) {
      expect(Object.keys(prebuild.targets).sort()).toEqual(RELEASE_BINARY_TARGETS.map((entry) => entry.target).sort())
    }
  })

  test("#given the native fixture #when loaded #then available entries resolve their own pin source", () => {
    const fixture = nativeFixture()
    fixture.prebuilds.senpi_grep.targets["darwin-arm64"]!.available = true
    const target = binaryBuilder.loadReleaseBinaryTargets(fixture, "1.2.3-test")[0]!
    expect(target.nativePrebuilds).toEqual([
      { fileStem: "senpi_pty", packageName: "@code-yeongyu/senpi-pty", pin: "2026.8.24", host: "darwin-arm64" },
      { fileStem: "senpi_grep", packageName: "@code-yeongyu/senpi", pin: "1.2.3-test", host: "darwin-arm64" },
    ])
    expect(target.enginePin).toBe("1.2.3-test")
  })

  test("#given the old fixture shape #when loaded #then it is rejected instead of silently dropping native prebuilds", () => {
    const oldFixture = {
      ptyPin: "2026.8.24",
      packageName: "@code-yeongyu/senpi-pty",
      targets: { "darwin-arm64": { ptyAvailable: true, prebuildHost: "darwin-arm64" } },
    }
    expect(() => binaryBuilder.loadReleaseBinaryTargets(oldFixture)).toThrow(/prebuilds/)
  })

  test("#given unavailable native entries with known hosts #when loaded #then they do not require payload files", () => {
    const targets = binaryBuilder.loadReleaseBinaryTargets(nativeFixture())
    expect(targets[0]!.nativePrebuilds.map((entry) => entry.fileStem)).toEqual(["senpi_pty"])
    expect(targets.slice(1).every((target) => target.nativePrebuilds.length === 0)).toBe(true)
  })

  test("#given a missing native target #when loaded #then it fails naming the package and target", () => {
    const fixture = nativeFixture()
    delete fixture.prebuilds.senpi_grep.targets["linux-x64"]
    expect(() => binaryBuilder.loadReleaseBinaryTargets(fixture)).toThrow(/senpi_grep.*linux-x64/)
  })

  test("#given an available entry without a host #when loaded #then it is rejected", () => {
    const fixture = nativeFixture()
    fixture.prebuilds.senpi_grep.targets["linux-x64-musl"]!.available = true
    expect(() => binaryBuilder.loadReleaseBinaryTargets(fixture)).toThrow(/prebuildHost/)
  })

  test("#given baseline and musl targets #when their native hosts are inspected #then baseline shares the base host and musl never uses glibc", () => {
    const fixture = JSON.parse(
      readFileSync(join(scriptDir, "release-binary-native-fixture.json"), "utf8"),
    ) as ReturnType<typeof nativeFixture>
    const grepHosts = Object.fromEntries(Object.entries(fixture.prebuilds.senpi_grep.targets)
      .map(([target, entry]) => [target, entry.prebuildHost]))
    expect(grepHosts).toEqual(GREP_HOSTS)
    for (const prebuild of Object.values(fixture.prebuilds)) {
      for (const [target, entry] of Object.entries(prebuild.targets)) {
        if (target.endsWith("-baseline")) {
          expect(entry.prebuildHost).toBe(prebuild.targets[target.replace(/-baseline$/, "")]!.prebuildHost)
        }
        if (target.includes("-musl")) {
          expect(entry.prebuildHost).toBeNull()
          expect(entry.available).toBe(false)
        }
      }
    }
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
      "native/prebuilds/darwin-arm64/senpi_grep.darwin-arm64.node",
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

describe("native prebuild staging", () => {
  for (const fileStem of ["senpi_pty", "senpi_grep"] as const) {
    const entry = {
      fileStem,
      packageName: fileStem === "senpi_pty" ? "@code-yeongyu/senpi-pty" : "@code-yeongyu/senpi",
      pin: fileStem === "senpi_pty" ? "2026.8.24" : "1.2.3-test",
      host: "darwin-arm64",
    }
    const relPath = `native/prebuilds/${entry.host}/${entry.fileStem}.${entry.host}.node`

    test(`#given local ${fileStem} #when staged #then only its exact file is copied without packing`, () => {
      const root = makeTempDir("omo-local-prebuild-")
      try {
        const packageDir = join(root, "local")
        const stageDir = join(root, "stage")
        stageParityFixture(packageDir, [relPath, "native/prebuilds/darwin-arm64/unrelated.node"])
        const staged = new Set<string>()
        binaryBuilder.stageNativePrebuild(entry, stageDir, staged, { resolvePackageDir: () => packageDir, runCommand: unexpectedPack })
        expect([...staged]).toEqual([relPath])
        expect(collectStagedFiles(stageDir)).toEqual([relPath])
        expect(readFileSync(join(stageDir, relPath))).toEqual(readFileSync(join(packageDir, relPath)))
        expect(statSync(join(stageDir, relPath)).mode & 0o777).toBe(statSync(join(packageDir, relPath)).mode & 0o777)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    test(`#given ${fileStem} absent locally #when staged #then npm packs its own package and pin and extracts its file`, () => {
      const root = makeTempDir("omo-packed-prebuild-")
      try {
        const archiveRoot = join(root, "archive")
        stageParityFixture(join(archiveRoot, "package"), [relPath, "native/prebuilds/darwin-arm64/unrelated.node"])
        const dependencies = packedPrebuildDependencies(join(root, "missing"), archiveRoot, `${entry.packageName}@${entry.pin}`)
        const staged = new Set<string>()
        binaryBuilder.stageNativePrebuild(entry, join(root, "stage"), staged, dependencies)
        expect(dependencies.commands).toEqual(["npm", "tar"])
        expect([...staged]).toEqual([relPath])
        expect(collectStagedFiles(join(root, "stage"))).toEqual([relPath])
        expect(readFileSync(join(root, "stage", relPath))).toEqual(readFileSync(join(archiveRoot, "package", relPath)))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    test(`#given available ${fileStem} with a missing file #when the host directory exists #then staging fails loudly`, () => {
      const root = makeTempDir("omo-missing-prebuild-")
      try {
        const archiveRoot = join(root, "archive")
        const localDir = join(root, "local")
        // A directory or a neighboring addon is not proof that the promised file exists.
        const otherFile = "native/prebuilds/darwin-arm64/unrelated.node"
        stageParityFixture(localDir, [otherFile])
        stageParityFixture(join(archiveRoot, "package"), [otherFile])
        const dependencies = packedPrebuildDependencies(localDir, archiveRoot, `${entry.packageName}@${entry.pin}`)
        const staged = new Set<string>()
        expect(() => binaryBuilder.stageNativePrebuild(entry, join(root, "stage"), staged, dependencies)).toThrow(`missing required sidecar source: ${relPath}`)
        expect(dependencies.commands).toEqual(["npm", "tar"])
        expect([...staged]).toEqual([])
        expect(existsSync(join(root, "stage", relPath))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }

  test("#given an installed PTY alias #when staged #then local resolution avoids the registry", () => {
    const root = makeTempDir("omo-installed-prebuild-")
    try {
      const entry = RELEASE_BINARY_TARGETS[0]!.nativePrebuilds[0]!
      const staged = new Set<string>()
      binaryBuilder.stageNativePrebuild(entry, root, staged, { runCommand: unexpectedPack })
      expect([...staged]).toEqual(["native/prebuilds/darwin-arm64/senpi_pty.darwin-arm64.node"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
    expect(relPaths).toContain("node_modules/@code-yeongyu/senpi-codemode/package.json")
    expect(relPaths).toContain("plugin/extensions/omo.js")
    expect(relPaths).toContain("plugin/skills/ast-grep/SKILL.md")
    expect(relPaths).toContain("native/prebuilds/darwin-arm64/senpi_pty.darwin-arm64.node")
  })

  test("#given an available grep entry #when expected paths are resolved #then its exact file is required even before installation", () => {
    const target = RELEASE_BINARY_TARGETS[0]!
    const relPaths = resolveExpectedSidecarRelPaths({
      ...target,
      nativePrebuilds: [
        ...target.nativePrebuilds,
        { fileStem: "senpi_grep", packageName: "@code-yeongyu/senpi", pin: target.enginePin, host: "darwin-arm64" },
      ],
    })
    expect(relPaths).toContain("native/prebuilds/darwin-arm64/senpi_pty.darwin-arm64.node")
    expect(relPaths).toContain("native/prebuilds/darwin-arm64/senpi_grep.darwin-arm64.node")
    expect(relPaths.filter((path) => path.startsWith("native/prebuilds/"))).toHaveLength(2)
  })

  test("#given a native-absent target #when the expected sidecar set is resolved #then no native prebuild is required", () => {
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
      const expectedRelPaths = resolveExpectedSidecarRelPaths(target)
      stageParityFixture(stageDir, expectedRelPaths)
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
      expect(embeddedRelPaths).toEqual(expectedRelPaths.slice().sort())
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
  test("#given the compiled OMO entry #when its engine imports are inspected #then both retain the standard patched engine literal", () => {
    // given
    const compileEntrySource = readFileSync(
      join(repoRoot, "packages", "omo-native", "compile-entry.ts"),
      "utf8",
    )

    // when
    const engineImports = compileEntrySource.match(
      /import\("\.\.\/\.\.\/node_modules\/@code-yeongyu\/senpi\/dist\/cli\.js"\)/g,
    )

    // then
    expect(engineImports).toHaveLength(2)
  })

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

// Regression: this list mirrors build-omo-native's payload allowlist by hand, so a directory added
// there (skills-conditional) silently stayed out of the compiled binary's embedded plugin.
describe("plugin payload mirror", () => {
  test("#given the native payload lists #when compared with the binary's copies #then both stay identical", () => {
    // when / then
    expect(PLUGIN_PAYLOAD_DIRECTORIES).toEqual(PAYLOAD_DIRECTORIES)
    expect(PLUGIN_PAYLOAD_FILES).toEqual(PAYLOAD_FILES)
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

describe("omob build info stamping", () => {
  const buildInfo = {
    command: "omob",
    omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: "2026-09-04T10:17:49+09:00", branch: "dev" },
    engine: { commit: "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7", committedAt: "2026-09-04T10:49:12+09:00", branch: "main" },
  }

  test("#given build info #when the sidecar package.json is stamped #then it carries omoBuild", () => {
    const stamped = JSON.parse(createStampedPackageJson("0.0.0-omob.c6e7dd7.7fd18df", buildInfo)) as Record<string, unknown>
    expect(stamped.omoBuild).toEqual(buildInfo)
  })

  test("#given no build info #when stamped #then the release shape stays byte-identical", () => {
    expect(createStampedPackageJson("9.9.9-0.test")).toBe(`${JSON.stringify({ name: "omo", version: "9.9.9-0.test" }, null, 2)}\n`)
  })

  test("#given build info #when the runtime manifest is built #then it records build info and changes the digest", async () => {
    const stageDir = makeTempDir("omo-manifest-buildinfo-")
    mkdirSync(join(stageDir, "theme"), { recursive: true })
    writeFileSync(join(stageDir, "theme", "dark.json"), "{}\n")
    const bare = await buildRuntimeManifest(stageDir, { omoAiVersion: "1.2.3", enginePin: "2026.8.24" })
    const stamped = await buildRuntimeManifest(stageDir, { omoAiVersion: "1.2.3", enginePin: "2026.8.24", buildInfo })
    expect(stamped.buildInfo).toEqual(buildInfo)
    expect(stamped.manifestSha).not.toBe(bare.manifestSha)
  })

  test("#given no build info #when the runtime manifest is built #then its key order matches the release contract", async () => {
    const stageDir = makeTempDir("omo-manifest-keyorder-")
    mkdirSync(join(stageDir, "theme"), { recursive: true })
    writeFileSync(join(stageDir, "theme", "dark.json"), "{}\n")

    const bare = await buildRuntimeManifest(stageDir, { omoAiVersion: "1.2.3", enginePin: "2026.8.24" })

    // release manifest key order — a reordering would change the embedded JSON bytes
    expect(Object.keys(bare)).toEqual(["omoAiVersion", "enginePin", "manifestSha", "entries"])
    expect("buildInfo" in bare).toBe(false)
  })
})
