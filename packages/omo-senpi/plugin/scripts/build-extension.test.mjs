import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"
import { fileURLToPath } from "node:url"

import { PERSONA_ASSET_FILES } from "@oh-my-opencode/memory-core/personas"

import {
  checkExtensionCurrent,
  loroWasmSourcePath,
  MEMORY_SYNC_ASSET_NAMES,
  MEMORY_SYNC_WASM_NAME,
  resolveBunExecutable,
  toPortableBuildPath,
} from "./build-extension.mjs"
import { createBuildFixture } from "./build-extension.test-support.mjs"
import { runtimePersonaSources } from "./persona-artifacts.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(scriptDir, "..")
const repoRoot = join(scriptDir, "..", "..", "..", "..")
const fixture = createBuildFixture()
const { sharedOutputs, mutableOutputs } = fixture

// A focused run builds the six artifacts twice in ~14s, while the package suite shares CPU and disk
// with other build/staging files. Keep the test bounded, but give the real two-build workload enough
// headroom under suite contention instead of timing out before the freshness assertion runs.
setDefaultTimeout(90_000)

afterEach(fixture.cleanupTest)
afterAll(fixture.cleanupFile)

describe("checkExtensionCurrent", () => {
  test("#given the eval SDK build #when inputs and exports are inspected #then the standalone entry has no dependencies", async () => {
    const outputs = await sharedOutputs()
    expect(outputs.toolkitSdkInputs.some(input => input.endsWith("src/extension/agent-toolkit-sdk.ts"))).toBe(true)
    expect(outputs.toolkitSdkInputs.filter(input => input.includes("node_modules/"))).toEqual([])
    const sdk = await import(outputs.toolkitSdkOutputPath)
    expect(Object.keys(sdk).sort()).toEqual(["SDK_VERSION", "ULW_LOOP_MANIFEST", "ULW_LOOP_OPERATIONS", "agentToolkit", "createAgentToolkit", "toolkitContextFromEnv"].sort())
  })

  test("#given a missing SDK artifact #when freshness is checked #then it reports that output", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.toolkitSdkOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: false, reason: "missing-output", output: outputs.toolkitSdkOutputPath })
  })

  test("#given the rollback migration runtime #when built #then its store entry and migration event are present", async () => {
    const outputs = await sharedOutputs()
    expect(outputs.rollbackRuntimeInputs.some(input => input.endsWith("src/extension/rollback-migrate-runtime.ts"))).toBe(true)
    expect(await readFile(outputs.rollbackRuntimeOutputPath, "utf8")).toContain("host_session_migrated")
  })

  test("#given the host platform #when resolving the Bun executable #then Windows bypasses the command shell", () => {
    expect(resolveBunExecutable("win32")).toBe("bun.exe")
    expect(resolveBunExecutable("darwin")).toBe("bun")
    expect(resolveBunExecutable("linux")).toBe("bun")
  })

  test("#given freshly built outputs #when the executable bundles are inspected #then the shebang stays the first bytes and the marker still parses", async () => {
    // given
    const outputs = await sharedOutputs()

    // when
    const supervisor = await readFile(outputs.supervisorOutputPath, "utf8")

    // then (Node's ESM loader strips a shebang only at byte 0; a marker above it breaks startup)
    for (const text of [supervisor]) {
      expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true)
      expect(text.indexOf("\n// omo:")).toBeGreaterThan(0)
    }
    // and the freshness round-trip still recognizes the artifacts
    const check = await checkExtensionCurrent({
      outputPath: outputs.outputPath,
      memberOutputPath: outputs.memberOutputPath,
      supervisorOutputPath: outputs.supervisorOutputPath,
    })
    // Compare the whole result so a failure names the stale artifact instead of printing "false".
    expect(check).toMatchObject({ ok: true })
  })

  test("#given an empty output directory #when extensions are built #then all runtime personas match their sources", async () => {
    // given / when
    const outputs = await sharedOutputs()
    const personas = [
      ["reflection-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "reflection-persona.md")],
      ["dream-persona.md", join(repoRoot, "packages", "memory-core", "src", "reflection", "assets", "dream-persona.md")],
      ["facts-persona.md", join(repoRoot, "packages", "memory-core", "src", "facts", "assets", "facts-persona.md")],
      // The kibitzer gate loads its persona from beside the BUNDLE, so an unstaged asset makes
      // every live gate launch fail with ENOENT while every source-reading unit test still passes.
      ["kibitzer-persona.md", join(repoRoot, "packages", "memory-core", "src", "recall", "assets", "kibitzer-persona.md")],
    ]

    // then
    for (const [name, source] of personas) {
      expect(await readFile(join(dirname(outputs.outputPath), name), "utf8")).toBe(await readFile(source, "utf8"))
    }
  })

  test("#given the runtime persona manifest #when staging sources are listed #then the staged names match it", () => {
    // given / when
    const staged = runtimePersonaSources(repoRoot).map(([name]) => name)

    // then
    expect(staged).toEqual([...PERSONA_ASSET_FILES])
  })

  test("#given platform-specific source paths #when normalized #then build markers use portable separators", () => {
    expect(toPortableBuildPath("packages\\omo-senpi\\src\\extension\\index.ts"))
      .toBe("packages/omo-senpi/src/extension/index.ts")
    expect(toPortableBuildPath("packages/omo-senpi/src/extension/index.ts"))
      .toBe("packages/omo-senpi/src/extension/index.ts")
  })

  test("#given current generated outputs with old mtimes #when checked #then freshness passes", async () => {
    // given
    const outputs = await mutableOutputs()
    const old = new Date(0)
    await Promise.all([
      utimes(outputs.outputPath, old, old),
      utimes(outputs.taskOutputPath, old, old),
      utimes(outputs.memberOutputPath, old, old),
    ])

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: true })
  })

  test("#given a missing supervisor artifact #when checked #then freshness reports that output", async () => {
    // given
    const outputs = await mutableOutputs()
    await rm(outputs.supervisorOutputPath)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "missing-output", output: outputs.supervisorOutputPath })
  })

  test("#given a stale supervisor artifact #when checked #then freshness reports that output", async () => {
    // given
    const outputs = await mutableOutputs()
    await appendFile(outputs.supervisorOutputPath, "\nchanged\n")

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.supervisorOutputPath })
  })

  test("#given changed generated bytes with future mtimes #when checked #then freshness fails", async () => {
    // given
    const outputs = await mutableOutputs()
    await appendFile(outputs.outputPath, "\nchanged\n")
    const future = new Date("2100-01-01T00:00:00.000Z")
    await utimes(outputs.outputPath, future, future)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.outputPath })
  })

  test("#given intact generated bytes with a stale source digest #when checked #then source reproduction fails", async () => {
    // given
    const outputs = await mutableOutputs()
    const artifact = await readFile(outputs.outputPath, "utf8")
    const newline = artifact.indexOf("\n")
    const [prefix, , bodyDigest] = artifact.slice(0, newline).split(":")
    await writeFile(outputs.outputPath, `${prefix}:${"0".repeat(43)}:${bodyDigest}\n${artifact.slice(newline + 1)}`)

    // when
    const result = await checkExtensionCurrent(outputs)

    // then
    expect(result).toMatchObject({ ok: false, reason: "stale-output", output: outputs.outputPath })
  })

  test("#given freshly built outputs #when inspected #then normalization removes whitespace-only lines", async () => {
    // given
    const outputs = await sharedOutputs()

    // when
    const main = await readFile(outputs.outputPath, "utf8")
    const task = await readFile(outputs.taskOutputPath, "utf8")
    const member = await readFile(outputs.memberOutputPath, "utf8")
    const advisorRuntime = await readFile(outputs.advisorRuntimeOutputPath, "utf8")

    // then
    expect(main).not.toMatch(/^[\t ]+$/m)
    expect(task).not.toMatch(/^[\t ]+$/m)
    expect(member).not.toMatch(/^[\t ]+$/m)
    expect(advisorRuntime).not.toMatch(/^[\t ]+$/m)
  })

  test("#given the split extension build #when metafile inputs are inspected #then task sources live only in the lazy sidecar", async () => {
    // given / when
    const { mainInputs, taskInputs } = await sharedOutputs()

    // then
    expect(mainInputs.some((input) => input.endsWith("packages/senpi-task/src/runners/in-process/curated-readonly-bash.ts")))
      .toBe(false)
    expect(taskInputs.some((input) => input.endsWith("packages/senpi-task/src/runners/in-process/curated-readonly-bash.ts")))
      .toBe(true)
  })

  test("#given the split extension build #when metafile inputs are inspected #then the computer-use implementation lives only in its lazy entry", async () => {
    // given / when
    const { mainInputs, computerUseInputs } = await sharedOutputs()
    const inMain = (suffix) => mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix))
    const inRuntime = (suffix) => computerUseInputs.some((input) => toPortableBuildPath(input).endsWith(suffix))

    // then
    for (const implementation of [
      "packages/senpi-desktop-service/src/index.ts",
      "packages/senpi-desktop-engine/src/index.ts",
      "packages/senpi-desktop-tool/src/activation.ts",
      "packages/omo-senpi/src/components/computer-use/engine-status.ts",
    ]) {
      expect(inMain(implementation), implementation).toBe(false)
      expect(inRuntime(implementation), implementation).toBe(true)
    }
    expect(inMain("packages/senpi-desktop-tool/src/registration.ts")).toBe(true)
  })

  test("#given the split extension build #when doctor inputs are inspected #then health checks load only from the lazy entry", async () => {
    const { mainInputs, memoryDoctorInputs } = await sharedOutputs()
    for (const suffix of [
      "packages/omo-senpi/src/components/memory/commands/doctor-runtime.ts",
      "packages/omo-senpi/src/components/memory/commands/doctor-checks.ts",
      "packages/omo-senpi/src/components/memory/commands/doctor-reservation.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(memoryDoctorInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
  })

  test("#given the split extension build #when memfs inputs are inspected #then maintenance handlers load only from the lazy entry", async () => {
    const { mainInputs, memoryMemfsInputs } = await sharedOutputs()
    for (const suffix of [
      "packages/omo-senpi/src/components/memory/commands/memfs-runtime.ts",
      "packages/omo-senpi/src/components/memory/commands/memfs-extra.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(memoryMemfsInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
  })

  test("#given lazy thread registration #when bundle inputs are inspected #then live RPC implementation is confined to its sidecar", async () => {
    const { mainInputs, threadClientInputs } = await sharedOutputs()
    const suffix = "/components/thread/live-surface.ts"
    expect(mainInputs.some(input => toPortableBuildPath(input).endsWith(suffix))).toBe(false)
    expect(threadClientInputs.some(input => toPortableBuildPath(input).endsWith(suffix))).toBe(true)
  })

  test("#given the split extension build #when palace inputs are inspected #then the /palace and /people runtime loads only from the lazy entry", async () => {
    const { mainInputs, memoryPalaceInputs } = await sharedOutputs()
    for (const suffix of [
      "packages/omo-senpi/src/components/memory/palace/runtime.ts",
      "packages/omo-senpi/src/components/memory/palace/generator.ts",
      "packages/omo-senpi/src/components/memory/palace/client-script.ts",
      "packages/omo-senpi/src/components/memory/palace/styles.ts",
      "packages/omo-senpi/src/components/memory/commands/people-runtime.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(memoryPalaceInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
  })

  test("#given the split extension build #when the palace sidecar is inspected #then it carries no runtime loader of its own", async () => {
    const { memoryPalaceInputs, memoryPalaceOutputPath } = await sharedOutputs()
    for (const suffix of [
      "packages/omo-senpi/src/components/memory/palace/runtime-loader.ts",
      "packages/omo-senpi/src/components/memory/palace/command.ts",
      "packages/omo-senpi/src/components/memory/commands/people.ts",
    ]) {
      expect(memoryPalaceInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
    }
    expect(await readFile(memoryPalaceOutputPath, "utf8")).not.toContain("#omo-memory-palace-runtime")
  })

  test("#given the split extension build #when onboarding inputs are inspected #then the session-history scan loads only from its lazy entry", async () => {
    const { mainInputs, sessionHistoryInputs, sessionHistoryOutputPath } = await sharedOutputs()
    for (const suffix of [
      "packages/omo-senpi/src/components/onboarding/session-history/runtime.ts",
      "packages/omo-senpi/src/components/onboarding/session-history/scan-session-history.ts",
      "packages/omo-senpi/src/components/onboarding/session-history/session-history-scanner.ts",
      "packages/omo-senpi/src/components/onboarding/session-history/transcript-parser.ts",
      "packages/omo-senpi/src/components/onboarding/session-history/digest-store.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(sessionHistoryInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
    for (const suffix of [
      "packages/omo-senpi/src/components/onboarding/session-history-runtime-loader.ts",
      "packages/omo-senpi/src/components/onboarding/session-history-rpc.ts",
      "packages/omo-senpi/src/components/onboarding/session-history-tool.ts",
    ]) {
      expect(sessionHistoryInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
    }
    expect(await readFile(sessionHistoryOutputPath, "utf8")).not.toContain("#omo-session-history-runtime")
  })

  test("#given the split extension build #when recall inputs are inspected #then the persisted-terms store loads only from its lazy entry", async () => {
    const { mainInputs, recallStoreInputs, recallStoreOutputPath } = await sharedOutputs()
    for (const suffix of [
      "packages/memory-core/src/recall/bm25-persist.ts",
      "packages/memory-core/src/recall/bm25-store.ts",
      "packages/memory-core/src/recall/bm25-persist-gate.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(recallStoreInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
    // The store seeds and reads the ranking's own index, which it is handed; a bundled copy would be a second index.
    expect(recallStoreInputs.some((input) => toPortableBuildPath(input).endsWith("packages/memory-core/src/recall/bm25-index.ts"))).toBe(false)
    expect(await readFile(recallStoreOutputPath, "utf8")).not.toContain("#omo-recall-store-runtime")
  })

  test("#given the split extension build #when telemetry inputs are inspected #then PostHog lives only in its lazy sidecar", async () => {
    const { mainInputs, telemetryPosthogInputs, telemetryPosthogOutputPath } = await sharedOutputs()
    expect(mainInputs.some(input => /node_modules\/posthog-(?:node|core)\//.test(toPortableBuildPath(input)))).toBe(false)
    expect(telemetryPosthogInputs.some(input => /node_modules\/posthog-node\//.test(toPortableBuildPath(input)))).toBe(true)
    expect(mainInputs.some(input => toPortableBuildPath(input).endsWith("/telemetry/posthog-runtime.ts"))).toBe(false)
    expect(await readFile(telemetryPosthogOutputPath, "utf8")).not.toContain("#omo-telemetry-posthog-runtime")
  })

  test("#given the split extension build #when sync inputs are inspected #then the Loro engine and its wasm live only in the sync sidecar", async () => {
    const { mainInputs, memorySyncInputs, memorySyncOutputPath, outputPath } = await sharedOutputs()
    for (const suffix of [
      "packages/memory-core/src/crdt/loro-runtime.ts",
      "packages/memory-core/src/sync/engine/index.ts",
    ]) {
      expect(mainInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(false)
      expect(memorySyncInputs.some((input) => toPortableBuildPath(input).endsWith(suffix)), suffix).toBe(true)
    }
    const wasm = await readFile(join(dirname(memorySyncOutputPath), MEMORY_SYNC_WASM_NAME))
    const source = await readFile(loroWasmSourcePath())
    expect(Buffer.compare(wasm, source)).toBe(0)
    expect(await readFile(memorySyncOutputPath, "utf8")).toContain(MEMORY_SYNC_WASM_NAME)
    expect(await readFile(outputPath, "utf8")).not.toContain(MEMORY_SYNC_WASM_NAME)
  })

  test("#given the sync sidecar build #when its output dir is listed #then every emitted asset is a declared sidecar asset", async () => {
    const { memorySyncOutputPath } = await sharedOutputs()
    const syncText = await readFile(memorySyncOutputPath, "utf8")
    const referenced = MEMORY_SYNC_ASSET_NAMES.filter((name) => syncText.includes(name))
    expect(referenced).toEqual([...MEMORY_SYNC_ASSET_NAMES])
    const emitted = (await readdir(dirname(memorySyncOutputPath), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !/\.(?:m?js|json|md)$/.test(entry.name))
      .map((entry) => entry.name)
    expect(emitted.sort()).toEqual([...MEMORY_SYNC_ASSET_NAMES].sort())
  })

  test("#given the sync sidecar packed with npm pack #when the installed package imports #omo-memory-sync-runtime under Node #then Loro initializes from the packed wasm", async () => {
    const { memorySyncOutputPath } = await sharedOutputs()
    const work = await mkdtemp(join(tmpdir(), "omo-sync-sidecar-pack-"))
    try {
      const pkg = join(work, "pkg")
      await mkdir(join(pkg, "extensions"), { recursive: true })
      await cp(join(pluginRoot, "package.json"), join(pkg, "package.json"))
      await cp(memorySyncOutputPath, join(pkg, "extensions", "omo-memory-sync.js"))
      for (const asset of MEMORY_SYNC_ASSET_NAMES) await cp(join(dirname(memorySyncOutputPath), asset), join(pkg, "extensions", asset))
      const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", work], { cwd: pkg, encoding: "utf8", shell: process.platform === "win32" })
      expect(packed.status, packed.stderr).toBe(0)
      const tarball = join(work, packed.stdout.trim().split("\n").at(-1))
      const installed = join(work, "installed")
      await mkdir(installed)
      const untar = spawnSync("tar", ["-xzf", tarball, "-C", installed], { encoding: "utf8" })
      expect(untar.status, untar.stderr).toBe(0)
      const root = join(installed, "package")
      const listed = await readdir(join(root, "extensions"))
      for (const asset of MEMORY_SYNC_ASSET_NAMES) expect(listed).toContain(asset)
      const probe = join(root, "sync-probe.mjs")
      await writeFile(probe, [
        'const sidecar = await import("#omo-memory-sync-runtime")',
        'if (typeof sidecar.openDeviceSync !== "function") throw new Error("openDeviceSync missing")',
        "await sidecar.checkSyncRuntime()",
        'console.log("sync-sidecar-ok")',
      ].join("\n"))
      const run = spawnSync("node", [probe], { cwd: parse(process.cwd()).root, encoding: "utf8", shell: process.platform === "win32" })
      expect(run.stdout, run.stderr).toContain("sync-sidecar-ok")
      expect(run.status, run.stderr).toBe(0)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }, 60000)

  test("#given a packaged task import map #when generated artifacts are inspected #then the main bundle resolves its task sidecar", async () => {
    const outputs = await sharedOutputs()
    const main = await readFile(outputs.outputPath, "utf8")
    const task = await readFile(outputs.taskOutputPath, "utf8")
    const manifest = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"))

    expect(main).toContain('import("#omo-task-runtime")')
    expect(main).toContain('import("#omo-memory-memfs-runtime")')
    expect(main).toContain('import("#omo-memory-palace-runtime")')
    expect(main).toContain('import("#omo-session-history-runtime")')
    expect(main).toContain('import("#omo-recall-store-runtime")')
    expect(main).toContain('import("#omo-telemetry-posthog-runtime")')
    expect(main).toContain('import("#omo-thread-client-runtime")')
    expect(main).toContain('import("#omo-memory-sync-runtime")')
    expect(task).toMatch(/^\/\/ omo:[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{43}/)
    expect(main).not.toContain('import("#omo-agent-toolkit-runtime")')
    expect(manifest.imports).not.toHaveProperty("#omo-agent-toolkit-runtime")
    expect(manifest.imports).toEqual({
      "#omo-task-runtime": "./extensions/omo-task.js",
      "#omo-computer-use-runtime": "./extensions/omo-computer-use.js",
      "#omo-memory-doctor-runtime": "./extensions/omo-memory-doctor.js",
      "#omo-memory-memfs-runtime": "./extensions/omo-memory-memfs.js",
      "#omo-memory-palace-runtime": "./extensions/omo-memory-palace.js",
      "#omo-session-history-runtime": "./extensions/omo-session-history.js",
      "#omo-recall-store-runtime": "./extensions/omo-recall-store.js",
      "#omo-telemetry-posthog-runtime": "./extensions/omo-telemetry-posthog.js",
      "#omo-memory-sync-runtime": "./extensions/omo-memory-sync.js",
      "#omo-thread-client-runtime": "./extensions/omo-thread-client.js",
      "#omo-agent-toolkit-sdk": "./runtime/agent-toolkit-sdk/sdk.js",
    })
  })
})
