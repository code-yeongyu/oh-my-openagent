/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"
import { z } from "zod"

import { DESKTOP_ENGINE_RELEASE_HOSTS, desktopEngineReleaseAssetName } from "../packages/senpi-desktop-engine/src/release-assets"
import { PLATFORMS } from "./build-binaries"
import { DESKTOP_ENGINE_TARGETS } from "./release-desktop-engine-target"
import { runBlock, sliceWorkflowSection } from "./release-workflow-test-steps"

// These tests spawn bash or bun children. On 16 windows-latest runs the slowest passed in 2.6 s,
// while cold runners went past Bun's 5 s default (#9386): the per-test budget absorbs those slow
// cold-runner spawns. It cannot catch a hang, because spawnSync blocks the timer that enforces it,
// so each spawn carries its own timeout: a hung child is killed and the test fails on its status.
const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
const SUBPROCESS_SPAWN_TIMEOUT_MS = 20_000

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const publishPlatformWorkflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)

describe("release and platform publish workflows", () => {
  test("enumerates windows-arm64 consistently across every platform-list surface", () => {
    // #given
    const publishSource = readFileSync(new URL("../script/publish.ts", import.meta.url), "utf8")
    const publishPlatformWorkflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    const publishIdsBlock = publishSource.slice(
      publishSource.indexOf("PLATFORM_PACKAGE_IDS = ["),
      publishSource.indexOf("] as const"),
    )
    const publishIds = [...publishIdsBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]).sort()

    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()

    const matrixLists = [...publishPlatformWorkflow.matchAll(/^\s*platform: \[([^\]]+)\]/gm)].map((match) =>
      match[1]
        .split(",")
        .map((value) => value.trim())
        .sort(),
    )

    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const publishYmlLists = [
      ...[...publishWorkflow.matchAll(/PLATFORMS=\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...publishWorkflow.matchAll(/for platform in (darwin-arm64[^\n;]*); do/g)].map((match) => match[1]),
    ].map((list) => list.trim().split(/\s+/).sort())

    // #when / #then
    expect(publishIds, "PLATFORM_PACKAGE_IDS must list windows-arm64").toContain("windows-arm64")
    expect(buildBinariesPlatforms, "build-binaries PLATFORMS must list windows-arm64").toContain("windows-arm64")
    expect(matrixLists.length, "publish-platform.yml must define both build and publish matrices").toBe(2)
    for (const matrixList of matrixLists) {
      expect(matrixList, "every publish-platform matrix must list windows-arm64").toContain("windows-arm64")
      expect(matrixList, "publish-platform matrix must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
    expect(publishIds, "PLATFORM_PACKAGE_IDS must match build-binaries PLATFORMS exactly").toEqual(
      buildBinariesPlatforms,
    )
    expect(publishYmlLists.length, "publish.yml must enumerate platforms in 2 PLATFORMS arrays + 2 prepared-source version-bump loops").toBe(4)
    for (const publishYmlList of publishYmlLists) {
      expect(publishYmlList, "every publish.yml platform list must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
  })

  test("matches the canonical platform set in optionalDependencies and on-disk platform packages", () => {
    // #given
    const rootManifest: { optionalDependencies?: Record<string, string> } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()
    const platformPrefix = "oh-my-opencode-"

    const optionalDependencyPlatforms = Object.keys(rootManifest.optionalDependencies ?? {})
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    const onDiskPlatforms = readdirSync(new URL("../packages/", import.meta.url))
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    // #when / #then
    expect(
      optionalDependencyPlatforms,
      "root optionalDependencies must list every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
    expect(
      onDiskPlatforms,
      "packages/ must contain a directory for every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
  })
})

describe("release binary asset lane in the platform publish workflow", () => {
  test("builds every available engine with the pinned target before compiled payload staging", () => {
    // Given the actual GitHub Actions job graph and the canonical target fixture.
    const stepsSchema = z.array(z.object({ name: z.string().optional(), run: z.string().optional(), if: z.string().optional() }))
    const workflow = z.object({ jobs: z.object({
      "desktop-engine": z.object({ strategy: z.object({ matrix: z.object({ include: z.array(z.object({
        host: z.string(), rust_target: z.string(), binary: z.string(),
      })) }) }), steps: stepsSchema }),
      build: z.object({ needs: z.literal("desktop-engine"), steps: stepsSchema }),
    }) }).parse(load(readFileSync(publishPlatformWorkflowPath, "utf8")))
    const engine = workflow.jobs["desktop-engine"]
    const build = workflow.jobs.build
    const step = (steps: z.infer<typeof stepsSchema>, name: string) => {
      const index = steps.findIndex((candidate) => candidate.name === name)
      const value = steps.at(index)
      if (index < 0 || value === undefined) throw new Error(`missing workflow step: ${name}`)
      return { index, value }
    }

    // When the four artifact producers and the twelve platform consumers are resolved.
    const install = step(engine.steps, "Install pinned Rust toolchain and target")
    const cargo = step(engine.steps, "Build desktop engine")
    const asset = step(engine.steps, "Stage desktop engine release asset")
    const resolve = step(build.steps, "Resolve desktop engine availability")
    const download = step(build.steps, "Download desktop engine for compiled payload")
    const stage = step(build.steps, "Stage target-specific Rust engine for compiled payload")
    const compile = step(build.steps, "Build release binary")

    // Then toolchain, triple, artifact transport and staging preserve the Cargo output path.
    expect(install.value.run).toContain("rust-toolchain.toml")
    expect(install.value.run).toContain('rustup toolchain install "$toolchain"')
    expect(install.value.run).toContain('rustup target add "${{ matrix.rust_target }}"')
    expect(install.index).toBeLessThan(cargo.index)
    expect(cargo.value.run).toContain('--target "${{ matrix.rust_target }}"')
    expect(cargo.index).toBeLessThan(asset.index)
    expect(asset.value.run).toContain('target/${{ matrix.rust_target }}/release/${{ matrix.binary }}')
    expect(resolve.index).toBeLessThan(download.index)
    expect(download.index).toBeLessThan(stage.index)
    expect(stage.index).toBeLessThan(compile.index)
    expect(download.value.if).toBe("steps.desktop-engine-target.outputs.host != ''")
    expect(stage.value.if).toBe(download.value.if)
    expect(stage.value.run).toContain('cp ".omo/desktop-engine-assets/$ENGINE_ASSET" "$ENGINE_SOURCE"')
    expect(compile.value.run).toContain("script/build-omo-binary.ts")
    expect(build.steps.some((candidate) => candidate.run?.includes("cargo build"))).toBe(false)
    expect(engine.strategy.matrix.include.map((entry) => entry.host)).toEqual([...DESKTOP_ENGINE_RELEASE_HOSTS])
    for (const target of DESKTOP_ENGINE_TARGETS) {
      if (!target.available) {
        expect(target.host).toBeNull()
        expect(target.source).toBeNull()
        continue
      }
      const producer = engine.strategy.matrix.include.find((entry) => entry.host === target.host)
      expect(producer).toBeDefined()
      expect(target.source).toBe(`target/${producer?.rust_target}/release/${producer?.binary}`)
    }
  })

  test("uploads one engine artifact per canonical host without baseline duplicates", () => {
    // Given the dedicated four-host build matrix.
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
    const engineJob = sliceWorkflowSection(workflow, "  desktop-engine:\n", "  build:\n")

    // When its host list is compared to the release asset contract, each asset has one producer.
    const hosts = [...engineJob.matchAll(/^\s+- \{ host: ([a-z0-9-]+), runner:/gm)].map((match) => match[1])
    expect(hosts).toEqual([...DESKTOP_ENGINE_RELEASE_HOSTS])
    expect(new Set(hosts).size).toBe(4)
    expect(engineJob).toContain("name: desktop-engine-${{ matrix.host }}")
  })

  test("runs the staged locator proof for changes to the release target fixture", () => {
    // Given a fixture change on either CI event.
    const workflow = readFileSync(new URL("../.github/workflows/desktop-engine.yml", import.meta.url), "utf8")
    const triggers = sliceWorkflowSection(workflow, "on:\n", "concurrency:\n")
    const proof = sliceWorkflowSection(workflow, "      - name: Prove staged desktop engine resolution and selftest\n", "      - name: Verify release asset assembly without publishing\n")

    // When the event paths are evaluated, both push and PR cover the fixture and target resolver.
    expect(triggers.match(/"script\/release-desktop-engine-fixture\.json"/g)).toHaveLength(2)
    expect(triggers.match(/"script\/release-desktop-engine-target\.ts"/g)).toHaveLength(2)
    expect(proof).toContain("bun script/desktop-engine-ci-proof.ts")
  })

  test("copies the canonical release artifact into the exact target-specific Rust source", () => {
    // Given the x64 Darwin cross-target and an artifact downloaded without a Rust target layout.
    const root = mkdtempSync(join(tmpdir(), "omo-engine-stage-"))
    try {
      const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
      const stage = runBlock(workflow, "      - name: Stage target-specific Rust engine for compiled payload\n", "      - name: Build release binary\n")
      const source = "target/x86_64-apple-darwin/release/senpi-desktop-engine"
      const asset = "senpi-desktop-engine-darwin-x64"
      const download = join(root, ".omo", "desktop-engine-assets")
      mkdirSync(download, { recursive: true })
      writeFileSync(join(download, asset), "x64 cross-target binary")

      // When the actual workflow staging step runs, only the declared triple receives the bytes.
      const result = spawnSync("bash", ["-e", "-c", stage], {
        cwd: root,
        env: { ...process.env, ENGINE_ASSET: asset, ENGINE_SOURCE: source },
        encoding: "utf8",
        timeout: SUBPROCESS_SPAWN_TIMEOUT_MS,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(root, source), "utf8")).toBe("x64 cross-target binary")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("rebuilds a baseline binary when its shared engine asset is absent", () => {
    // Given an existing omo baseline binary but no Darwin x64 engine release asset.
    const root = mkdtempSync(join(tmpdir(), "omo-engine-release-check-"))
    try {
      const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
      const check = runBlock(workflow, "      - name: Check release assets\n", "      - name: Resolve desktop engine availability\n")
        .replaceAll("${{ matrix.platform }}", "darwin-x64-baseline")
      const gh = join(root, "gh")
      writeFileSync(gh, "#!/bin/bash\nif [ \"$1\" = release ] && [ \"$2\" = view ]; then cat \"$ASSET_NAMES_FILE\"; else exit 1; fi\n")
      chmodSync(gh, 0o755)
      const names = join(root, "asset-names")
      const output = join(root, "output")
      const env = {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        VERSION: "5.0.0",
        OMO_AI_VERSION: "5.0.0",
        ASSET_NAMES_FILE: names,
        GITHUB_OUTPUT: output,
      }

      // When only the executable exists, the real workflow shell must request a build.
      writeFileSync(names, "omo-darwin-x64-baseline\n")
      const missing = spawnSync("bash", ["-e", "-c", check], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: SUBPROCESS_SPAWN_TIMEOUT_MS })
      expect(missing.status, missing.stderr).toBe(0)
      expect(readFileSync(output, "utf8")).toContain("binary_exists=false")

      // When the shared engine is also present, the release bytes are reused.
      writeFileSync(names, "omo-darwin-x64-baseline\nsenpi-desktop-engine-darwin-x64\n")
      writeFileSync(output, "")
      const complete = spawnSync("bash", ["-e", "-c", check], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: SUBPROCESS_SPAWN_TIMEOUT_MS })
      expect(complete.status, complete.stderr).toBe(0)
      expect(readFileSync(output, "utf8")).toContain("binary_exists=true")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("verifies precisely twelve launchers and four engines on reruns without publishing", () => {
    // Given a synthetic release with canonical names and independently computed hashes.
    const root = mkdtempSync(join(tmpdir(), "omo-engine-assets-"))
    try {
      const assets = join(root, "assets")
      mkdirSync(assets)
      const binaries = PLATFORMS.map(({ platform }) => `omo-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`)
      const engines = DESKTOP_ENGINE_RELEASE_HOSTS.map((host) => desktopEngineReleaseAssetName(host))
      if (engines.some((asset) => asset === null)) throw new Error("release host without asset name")
      const checksum = (name: string): string => {
        const bytes = `test executable ${name}\n`
        writeFileSync(join(assets, name), bytes)
        return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`
      }
      writeFileSync(join(assets, "SHA256SUMS"), `${binaries.map(checksum).join("\n")}\n`)
      writeFileSync(join(assets, "senpi-desktop-engine-checksums.txt"), `${engines.map((name) => checksum(name ?? "")).join("\n")}\n`)
      const gh = join(root, "gh")
      writeFileSync(gh, "#!/bin/bash\n[ \"$1\" = release ] && [ \"$2\" = download ] || exit 1\ncp \"$ASSET_SOURCE_DIR\"/* \"${@: -1}/\"\n")
      chmodSync(gh, 0o755)
      if (spawnSync("bash", ["-c", "command -v shasum"], { timeout: SUBPROCESS_SPAWN_TIMEOUT_MS }).status !== 0) {
        const shasum = join(root, "shasum")
        writeFileSync(shasum, "#!/bin/bash\n[ \"$1\" = -a ] && [ \"$2\" = 256 ] || exit 2\nshift 2\nexec sha256sum \"$@\"\n")
        chmodSync(shasum, 0o755)
      }
      const workflow = readFileSync(publishWorkflowPath, "utf8")
      const verify = runBlock(workflow, "      - name: Verify uploaded assets\n", "      - name: Delete draft release\n")
      const execute = () => spawnSync("bash", ["-e", "-c", verify], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}`, VERSION: "5.0.0", ASSET_SOURCE_DIR: assets },
        encoding: "utf8",
        timeout: SUBPROCESS_SPAWN_TIMEOUT_MS,
      })

      // When every release asset exists, the actual workflow verification passes.
      const complete = execute()
      expect(complete.status, complete.stderr).toBe(0)
      expect(complete.stdout).toContain("Verified 18/18 release assets")

      // When the engine asset is absent, a skip_platform rerun cannot go green.
      unlinkSync(join(assets, "senpi-desktop-engine-darwin-x64"))
      const missing = execute()
      expect(missing.status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)
})
