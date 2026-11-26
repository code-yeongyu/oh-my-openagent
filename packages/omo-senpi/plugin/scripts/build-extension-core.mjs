import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { builtinModules, createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { attachBuildMarker, minifyBundle, normalizeBuiltinImports, toPortableBuildPath } from "./build-artifact.mjs"
import { stageRuntimePersonas } from "./persona-artifacts.mjs"
import { SDK_RUNTIME_FILES, sdkRuntimeOutputPaths } from "./runtime-files.mjs"

export function resolveBunExecutable(platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun"
}

export const SENPI_LOADER_ALIASES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@code-yeongyu/senpi",
  "@code-yeongyu/senpi/session-worker-data",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-tui",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-ai/compat",
  "@mariozechner/pi-ai/oauth",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
]

const scriptDir = dirname(fileURLToPath(import.meta.url))
const buildScriptPath = fileURLToPath(new URL("./build-extension.mjs", import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = join(packageRoot, "..", "..")
const entryPath = join(packageRoot, "src", "extension", "bundled-index.ts")
const outputPath =
  process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
    ? join(pluginRoot, "extensions", "omo.js")
    : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo.js")
const taskEntryPath = join(packageRoot, "src", "extension", "omo-task.ts")
const taskOutputPath =
  process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
    ? join(pluginRoot, "extensions", "omo-task.js")
    : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-task.js")
const memberEntryPath = join(repoRoot, "packages", "senpi-task", "src", "team", "member-extension", "index.ts")
const memberOutputPath =
  process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
    ? join(pluginRoot, "extensions", "omo-member.js")
    : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-member.js")
const supervisorEntryPath = join(packageRoot, "src", "components", "memory", "worker", "memory-run-supervisor.ts")
const supervisorOutputPath =
  process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
    ? join(pluginRoot, "extensions", "memory-run-supervisor.mjs")
    : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "memory-run-supervisor.mjs")
// The thread gateway's store runs in a worker thread (`new Worker(url)`), which a bundler cannot
// inline, so it ships as its own entry beside omo.js; `gateway/store.ts` resolves this name from
// its own module location and falls back to `store-worker.ts` in source.
export const GATEWAY_STORE_WORKER_NAME = "gateway-store-worker.mjs"
const gatewayStoreWorkerEntryPath = join(packageRoot, "src", "components", "thread", "gateway", "store-worker.ts")
const gatewayStoreWorkerOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  GATEWAY_STORE_WORKER_NAME,
)
const toolkitSdkEntryPath = join(packageRoot, "src", "extension", "agent-toolkit-sdk.ts")
const toolkitSdkOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "runtime",
  "agent-toolkit-sdk",
  "sdk.js",
)
const bunshinTsEntryPath = join(packageRoot, "src", "extension", "bunshin-ts-sdk.ts")
const bunshinTsOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "runtime", "bunshin-ts", "sdk.js")
// The account, device, device-service and configuration SDK eval cells import from OMO_SDK_ROOT. The SDK runtime files
// (runtime-files.mjs) are written at their table outputs under one plugin output root.
const sdkRuntimeRootPath = process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot
// The `omo thread` CLI and connector scripts import this SDK without an agent session; it points
// the gateway store at the worker sidecar in `extensions/` (two levels up from its own file).
export const THREAD_SDK_RELATIVE_PATH = join("runtime", "thread-sdk", "sdk.js")
const threadSdkEntryPath = join(packageRoot, "src", "extension", "thread-sdk.ts")
const threadSdkOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, THREAD_SDK_RELATIVE_PATH)
const advisorRuntimeEntryPath = join(packageRoot, "src", "components", "init-deep-advisor", "runtime.ts")
const advisorRuntimeOutputPath =
  process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
    ? join(pluginRoot, "extensions", "omo-init-deep-advisor.js")
    : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-init-deep-advisor.js")
const sidePanelRuntimeEntryPath = join(packageRoot, "src", "components", "side-panel", "runtime.ts")
const sidePanelRuntimeOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-side-panel.js",
)
const onboardingScanRuntimeEntryPath = join(packageRoot, "src", "components", "onboarding", "scan-runtime.ts")
const onboardingScanRuntimeOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-onboarding-scan.js",
)
const computerUseEntryPath = join(packageRoot, "src", "components", "computer-use", "runtime.ts")
const computerUseOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-computer-use.js",
)
// The computer.run QuickJS cell runs in a worker thread, which a bundler cannot inline: its entry ships
// as its own bundle (quickjs-wasi inlined) beside omo-computer-use.js, with the engine's wasm next to it.
// `senpi-desktop-service/src/run/sandbox/quickjs.ts` resolves both names from its own module location.
const computerRunWorkerEntryPath = join(
  repoRoot,
  "packages",
  "senpi-desktop-service",
  "src",
  "run",
  "sandbox",
  "worker.ts",
)
export const COMPUTER_RUN_WORKER_NAME = "omo-computer-run-worker.mjs"
export const COMPUTER_RUN_WASM_NAME = "quickjs.wasm"
// The wasm the INSTALLED quickjs-wasi ships: the freshness check pins the staged copy to it.
export function computerRunWasmSourcePath() {
  return createRequire(join(repoRoot, "packages", "senpi-desktop-service", "package.json")).resolve(
    `quickjs-wasi/${COMPUTER_RUN_WASM_NAME}`,
  )
}
const memoryDoctorEntryPath = join(packageRoot, "src", "components", "memory", "commands", "doctor-runtime.ts")
const memoryMemfsEntryPath = join(packageRoot, "src", "components", "memory", "commands", "memfs-runtime.ts")
const memoryPalaceEntryPath = join(packageRoot, "src", "components", "memory", "palace", "runtime.ts")
const deviceAccountEntryPath = join(packageRoot, "src", "components", "memory", "device-session", "account-runtime.ts")
const memoryCommandsEntryPath = join(packageRoot, "src", "components", "memory", "commands", "runtime.ts")
const sessionHistoryEntryPath = join(packageRoot, "src", "components", "onboarding", "session-history", "runtime.ts")
const recallStoreEntryPath = join(packageRoot, "src", "components", "memory", "recall-store-runtime.ts")
const deviceServiceEntryPath = join(packageRoot, "src", "components", "device-service", "runtime.ts")
const telemetryPosthogEntryPath = join(packageRoot, "src", "components", "telemetry", "posthog-runtime.ts")
const telemetryOtlpEntryPath = join(packageRoot, "src", "components", "telemetry", "otlp-runtime.ts")
// The sync engine sidecar carries the Loro runtime; its wasm is emitted beside it under this fixed name
// (the engine's loader reads it relative to its own module), so omo.js never pulls Loro in.
const memorySyncEntryPath = join(packageRoot, "src", "components", "memory", "sync-runtime.ts")
export const MEMORY_SYNC_WASM_NAME = "loro_wasm_bg.wasm"
// Every file the sync sidecar loads from beside itself; a build test fails on any undeclared asset.
export const MEMORY_SYNC_ASSET_NAMES = [MEMORY_SYNC_WASM_NAME, "CaseFolding.txt"]
// Where each asset comes from, for the freshness check.
export function memorySyncAssetSources() {
  return {
    [MEMORY_SYNC_WASM_NAME]: loroWasmSourcePath(),
    "CaseFolding.txt": join(repoRoot, "packages", "memory-core", "src", "sync", "item", "CaseFolding.txt"),
  }
}
// The wasm the INSTALLED Loro package ships: the freshness check pins the committed copy to it, so a Loro
// bump without a rebuild is reported stale instead of shipping an old binary.
export function loroWasmSourcePath() {
  return createRequire(join(repoRoot, "packages", "memory-core", "package.json")).resolve(
    `loro-crdt/bundler/${MEMORY_SYNC_WASM_NAME}`,
  )
}
const threadClientEntryPath = join(packageRoot, "src", "components", "thread", "live-surface.ts")
const wakeEntryPath = join(packageRoot, "src", "components", "thread", "wake", "wake-runtime.ts")
const telemetryRecoveryEntryPath = join(packageRoot, "src", "components", "telemetry", "session-summary-recovery.ts")
const feedbackEntryPath = join(packageRoot, "src", "components", "feedback", "runtime.ts")
const desktopToolkitEntryPath = join(packageRoot, "src", "components", "desktop-toolkit", "runtime.ts")
const claimReceiptEntryPath = join(packageRoot, "src", "components", "claim-receipt", "runtime.ts")
const memoryDoctorOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-memory-doctor.js",
)
const memoryMemfsOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-memory-memfs.js",
)
const memoryPalaceOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-memory-palace.js",
)
const deviceAccountOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-device-account.js",
)
const memoryCommandsOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-memory-commands.js",
)
const sessionHistoryOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-session-history.js",
)
const recallStoreOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-recall-store.js",
)
const deviceServiceOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-device-service.js",
)
const telemetryPosthogOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-telemetry-posthog.js",
)
const telemetryOtlpOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-telemetry-otlp.js",
)
const memorySyncOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-memory-sync.js")
const threadClientOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-thread-client.js",
)
const wakeOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-wake.js")
const telemetryRecoveryOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-telemetry-recovery.js",
)
const feedbackOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-feedback.js")
const desktopToolkitOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-desktop-toolkit.js",
)
const claimReceiptOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "extensions",
  "omo-claim-receipt.js",
)
// The computer-use prelude JSON: bundled modules read it from beside the bundle (extensions/), the
// same contract as the staged personas, so omo.js carries none of the ~29 KB of prelude text (#9113).
export const COMPUTER_PRELUDE_ASSET_NAME = "assets.generated.json"
const computerPreludeAssetSource = join(repoRoot, "packages", "senpi-desktop-prelude", "src", "assets.generated.json")
const rollbackRuntimeEntryPath = join(packageRoot, "src", "extension", "rollback-migrate-runtime.ts")
const rollbackRuntimeOutputPath = join(
  process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot,
  "runtime",
  "rollback-migrate.js",
)
const builtinModuleNames = builtinModules.filter((moduleName) => !moduleName.startsWith("_")).sort()
const externalSpecifiers = [
  "#omo-desktop-toolkit-runtime",
  "#omo-task-runtime",
  "#omo-computer-use-runtime",
  "#omo-memory-doctor-runtime",
  "#omo-memory-memfs-runtime",
  "#omo-memory-palace-runtime",
  "#omo-device-account-runtime",
  "#omo-memory-commands-runtime",
  // memory-core's lazy dream archive link repair; the plugin manifest maps it to the memory-commands sidecar.
  "#memory-completion-links",
  "#omo-session-history-runtime",
  "#omo-recall-store-runtime",
  "#omo-device-service-runtime",
  // memory-core's lazy <external_projection> renderer; the plugin manifest maps it to the recall-store sidecar.
  "#memory-external-projection",
  "#omo-telemetry-posthog-runtime",
  "#omo-telemetry-otlp-runtime",
  "#omo-memory-sync-runtime",
  "#omo-thread-client-runtime",
  "#omo-wake-runtime",
  "#omo-telemetry-recovery-runtime",
  // telemetry-core loads its immediate sender through this import; the plugin manifest maps it to the recovery sidecar.
  "#telemetry-immediate-send",
  "#omo-feedback-runtime",
  "#omo-claim-receipt-runtime",
  "#omo-agent-toolkit-sdk",
  "#bunshin-ts",
  ...SENPI_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]
const sdkExternalSpecifiers = [...builtinModuleNames, ...builtinModuleNames.map((name) => `node:${name}`)]
// #14204: `omo thread` and `omo daemon` import the thread client with a plain dynamic import, outside any engine, and
// the compiled runtime ships no node_modules, so a bare `typebox` there cannot resolve. The sidecar inlines TypeBox
// instead of leaning on the engine's loader alias. TypeBox 1.x tags schemas with plain `~kind` string keys, so the
// sidecar's copy produces schemas the engine's TypeBox reads as its own.
const TYPEBOX_LOADER_ALIASES = new Set(
  SENPI_LOADER_ALIASES.filter((specifier) => /^(@sinclair\/)?typebox(\/|$)/.test(specifier)),
)
const threadClientExternalSpecifiers = externalSpecifiers.filter((specifier) => !TYPEBOX_LOADER_ALIASES.has(specifier))
const BUILD_SETTINGS = JSON.stringify({
  target: "node",
  format: "esm",
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  secondaryMinifier: "terser@5.44.0",
  loaderAliases: SENPI_LOADER_ALIASES,
})
// #13155: the externals list carries the running node's builtinModules (node 26 adds node:ffi), and it
// feeds the marker digest, so a byte-identical bundle built under another node read as stale. The digest
// therefore records the builtin family as ONE stable token and digests only the source-derived
// externals, which is what freshness must track.
const NODE_BUILTIN_SET_MARKER = "<node-builtins>"
export function digestSettingsFor(externals, builtinNames) {
  const builtins = new Set(builtinNames)
  const sourceDerived = externals.filter((specifier) => !builtins.has(specifier) && !specifier.startsWith("node:"))
  return JSON.stringify({ settings: BUILD_SETTINGS, externals: [...sourceDerived, NODE_BUILTIN_SET_MARKER] })
}

export const extensionBuildPaths = {
  scriptDir,
  pluginRoot,
  packageRoot,
  repoRoot,
  outputPath,
  taskOutputPath,
  memberOutputPath,
  supervisorOutputPath,
  toolkitSdkOutputPath,
  bunshinTsOutputPath,
  sdkRuntimeRootPath,
  threadSdkOutputPath,
  advisorRuntimeOutputPath,
  sidePanelRuntimeOutputPath,
  onboardingScanRuntimeOutputPath,
  rollbackRuntimeOutputPath,
  computerUseOutputPath,
  memoryDoctorOutputPath,
  memoryMemfsOutputPath,
  memoryPalaceOutputPath,
  deviceAccountOutputPath,
  memoryCommandsOutputPath,
  sessionHistoryOutputPath,
  recallStoreOutputPath,
  deviceServiceOutputPath,
  telemetryPosthogOutputPath,
  telemetryOtlpOutputPath,
  memorySyncOutputPath,
  threadClientOutputPath,
  wakeOutputPath,
  telemetryRecoveryOutputPath,
  feedbackOutputPath,
  desktopToolkitOutputPath,
  claimReceiptOutputPath,
  gatewayStoreWorkerOutputPath,
}

// An explicit path wins; with only `outputPath` set, every sidecar lands beside it.
export function resolveOutputs(options) {
  const output = options.outputPath ?? outputPath
  const sibling = (explicit, fallback, relativePath) =>
    explicit ?? (options.outputPath === undefined ? fallback : join(dirname(output), relativePath))
  return {
    output,
    taskOutput: sibling(options.taskOutputPath, taskOutputPath, "omo-task.js"),
    memberOutput: sibling(options.memberOutputPath, memberOutputPath, "omo-member.js"),
    supervisorOutput: sibling(options.supervisorOutputPath, supervisorOutputPath, "memory-run-supervisor.mjs"),
    advisorRuntimeOutput: sibling(
      options.advisorRuntimeOutputPath,
      advisorRuntimeOutputPath,
      "omo-init-deep-advisor.js",
    ),
    sidePanelRuntimeOutput: sibling(
      options.sidePanelRuntimeOutputPath,
      sidePanelRuntimeOutputPath,
      "omo-side-panel.js",
    ),
    onboardingScanRuntimeOutput: sibling(
      options.onboardingScanRuntimeOutputPath,
      onboardingScanRuntimeOutputPath,
      "omo-onboarding-scan.js",
    ),
    toolkitSdkOutput: sibling(
      options.toolkitSdkOutputPath,
      toolkitSdkOutputPath,
      join("runtime", "agent-toolkit-sdk", "sdk.js"),
    ),
    bunshinTsOutput: sibling(options.bunshinTsOutputPath, bunshinTsOutputPath, join("runtime", "bunshin-ts", "sdk.js")),
    // Named explicitly or, with only `outputPath` set, beside it; never derived from another file's path.
    sdkRuntimeOutputs: sdkRuntimeOutputPaths(
      options.sdkRuntimeRoot ?? (options.outputPath === undefined ? sdkRuntimeRootPath : dirname(output)),
    ),
    threadSdkOutput: sibling(options.threadSdkOutputPath, threadSdkOutputPath, THREAD_SDK_RELATIVE_PATH),
    rollbackRuntimeOutput: sibling(
      options.rollbackRuntimeOutputPath,
      rollbackRuntimeOutputPath,
      join("runtime", "rollback-migrate.js"),
    ),
    memoryDoctorOutput: sibling(options.memoryDoctorOutputPath, memoryDoctorOutputPath, "omo-memory-doctor.js"),
    memoryMemfsOutput: sibling(options.memoryMemfsOutputPath, memoryMemfsOutputPath, "omo-memory-memfs.js"),
    memoryPalaceOutput: sibling(options.memoryPalaceOutputPath, memoryPalaceOutputPath, "omo-memory-palace.js"),
    deviceAccountOutput: sibling(options.deviceAccountOutputPath, deviceAccountOutputPath, "omo-device-account.js"),
    memoryCommandsOutput: sibling(options.memoryCommandsOutputPath, memoryCommandsOutputPath, "omo-memory-commands.js"),
    sessionHistoryOutput: sibling(options.sessionHistoryOutputPath, sessionHistoryOutputPath, "omo-session-history.js"),
    recallStoreOutput: sibling(options.recallStoreOutputPath, recallStoreOutputPath, "omo-recall-store.js"),
    deviceServiceOutput: sibling(options.deviceServiceOutputPath, deviceServiceOutputPath, "omo-device-service.js"),
    telemetryPosthogOutput: sibling(
      options.telemetryPosthogOutputPath,
      telemetryPosthogOutputPath,
      "omo-telemetry-posthog.js",
    ),
    telemetryOtlpOutput: sibling(options.telemetryOtlpOutputPath, telemetryOtlpOutputPath, "omo-telemetry-otlp.js"),
    memorySyncOutput: sibling(options.memorySyncOutputPath, memorySyncOutputPath, "omo-memory-sync.js"),
    threadClientOutput: sibling(options.threadClientOutputPath, threadClientOutputPath, "omo-thread-client.js"),
    wakeOutput: sibling(options.wakeOutputPath, wakeOutputPath, "omo-wake.js"),
    telemetryRecoveryOutput: sibling(
      options.telemetryRecoveryOutputPath,
      telemetryRecoveryOutputPath,
      "omo-telemetry-recovery.js",
    ),
    feedbackOutput: sibling(options.feedbackOutputPath, feedbackOutputPath, "omo-feedback.js"),
    desktopToolkitOutput: sibling(options.desktopToolkitOutputPath, desktopToolkitOutputPath, "omo-desktop-toolkit.js"),
    claimReceiptOutput: sibling(options.claimReceiptOutputPath, claimReceiptOutputPath, "omo-claim-receipt.js"),
    computerUseOutput: sibling(options.computerUseOutputPath, computerUseOutputPath, "omo-computer-use.js"),
    gatewayStoreWorkerOutput: sibling(
      options.gatewayStoreWorkerOutputPath,
      gatewayStoreWorkerOutputPath,
      GATEWAY_STORE_WORKER_NAME,
    ),
  }
}

export const omoSenpiBuildDefines = (version) => ({ OMO_SENPI_PACKAGE_VERSION: version, OMO_SENPI_BUNDLED: true })

// The root SDK runtime's externals: node builtins, and the wake sidecar the root's thread core carries like the thread
// SDK below (#14972). plugin/scripts/omo-sdk-static-set.mjs builds with the same list.
// Every SDK runtime file leaves node builtins, the wake sidecar the thread core carries (#14972) and every OTHER SDK
// runtime file of the table external, lazy or not, so no file inlines another (slice P1c, #15031; review 6076881626).
export const runtimeFileExternals = (row, table = SDK_RUNTIME_FILES) => [
  ...sdkExternalSpecifiers,
  "#omo-wake-runtime",
  ...table.filter((other) => other !== row).map((other) => other.specifier),
]

export async function buildExtension(options = {}) {
  const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("omo-senpi package manifest must contain a version")
  }
  const buildDefines = omoSenpiBuildDefines(packageManifest.version)
  const {
    output,
    taskOutput,
    memberOutput,
    supervisorOutput,
    advisorRuntimeOutput,
    sidePanelRuntimeOutput,
    onboardingScanRuntimeOutput,
    toolkitSdkOutput,
    bunshinTsOutput,
    sdkRuntimeOutputs,
    threadSdkOutput,
    rollbackRuntimeOutput,
    computerUseOutput,
    memoryDoctorOutput,
    memoryMemfsOutput,
    memoryPalaceOutput,
    deviceAccountOutput,
    memoryCommandsOutput,
    sessionHistoryOutput,
    recallStoreOutput,
    deviceServiceOutput,
    telemetryPosthogOutput,
    telemetryOtlpOutput,
    memorySyncOutput,
    threadClientOutput,
    wakeOutput,
    telemetryRecoveryOutput,
    feedbackOutput,
    desktopToolkitOutput,
    claimReceiptOutput,
    gatewayStoreWorkerOutput,
  } = resolveOutputs(options)
  const toolkitSdkInputs = await buildEntry(toolkitSdkEntryPath, toolkitSdkOutput, buildDefines, sdkExternalSpecifiers)
  const bunshinTsInputs = await buildEntry(bunshinTsEntryPath, bunshinTsOutput, buildDefines, sdkExternalSpecifiers)
  // The root's thread core carries the same parked-session wake as the thread SDK below (#14972), loaded the same way.
  const sdkRuntimeInputs = await buildSdkRuntimeFiles(sdkRuntimeOutputs, buildDefines)
  const mainInputs = await buildEntry(entryPath, output, buildDefines)
  const taskInputs = await buildEntry(taskEntryPath, taskOutput, buildDefines)
  const memberInputs = await buildEntry(memberEntryPath, memberOutput, buildDefines)
  const supervisorInputs = await buildEntry(supervisorEntryPath, supervisorOutput, buildDefines)
  const advisorRuntimeInputs = await buildEntry(advisorRuntimeEntryPath, advisorRuntimeOutput, buildDefines)
  const sidePanelRuntimeInputs = await buildEntry(sidePanelRuntimeEntryPath, sidePanelRuntimeOutput, buildDefines)
  const onboardingScanRuntimeInputs = await buildEntry(
    onboardingScanRuntimeEntryPath,
    onboardingScanRuntimeOutput,
    buildDefines,
  )
  const rollbackRuntimeInputs = await buildEntry(
    rollbackRuntimeEntryPath,
    rollbackRuntimeOutput,
    buildDefines,
    sdkExternalSpecifiers,
  )
  const memoryDoctorInputs = await buildEntry(memoryDoctorEntryPath, memoryDoctorOutput, buildDefines)
  const memoryMemfsInputs = await buildEntry(memoryMemfsEntryPath, memoryMemfsOutput, buildDefines)
  const memoryPalaceInputs = await buildEntry(memoryPalaceEntryPath, memoryPalaceOutput, buildDefines)
  const deviceAccountInputs = await buildEntry(deviceAccountEntryPath, deviceAccountOutput, buildDefines)
  const memoryCommandsInputs = await buildEntry(memoryCommandsEntryPath, memoryCommandsOutput, buildDefines)
  const sessionHistoryInputs = await buildEntry(sessionHistoryEntryPath, sessionHistoryOutput, buildDefines)
  const recallStoreInputs = await buildEntry(recallStoreEntryPath, recallStoreOutput, buildDefines)
  const deviceServiceInputs = await buildEntry(deviceServiceEntryPath, deviceServiceOutput, buildDefines)
  const telemetryPosthogInputs = await buildEntry(telemetryPosthogEntryPath, telemetryPosthogOutput, buildDefines)
  const telemetryOtlpInputs = await buildEntry(telemetryOtlpEntryPath, telemetryOtlpOutput, buildDefines)
  const memorySyncInputs = await buildEntry(memorySyncEntryPath, memorySyncOutput, buildDefines, externalSpecifiers, {
    assets: true,
  })
  const threadClientInputs = await buildEntry(
    threadClientEntryPath,
    threadClientOutput,
    buildDefines,
    threadClientExternalSpecifiers,
  )
  const wakeInputs = await buildEntry(wakeEntryPath, wakeOutput, buildDefines)
  const telemetryRecoveryInputs = await buildEntry(telemetryRecoveryEntryPath, telemetryRecoveryOutput, buildDefines)
  const feedbackInputs = await buildEntry(feedbackEntryPath, feedbackOutput, buildDefines)
  const desktopToolkitInputs = await buildEntry(desktopToolkitEntryPath, desktopToolkitOutput, buildDefines)
  const claimReceiptInputs = await buildEntry(claimReceiptEntryPath, claimReceiptOutput, buildDefines)
  const computerUseInputs = await buildEntry(computerUseEntryPath, computerUseOutput, buildDefines)
  const computerRunWorkerInputs = await buildEntry(
    computerRunWorkerEntryPath,
    join(dirname(computerUseOutput), COMPUTER_RUN_WORKER_NAME),
    buildDefines,
    sdkExternalSpecifiers,
  )
  await copyFile(computerRunWasmSourcePath(), join(dirname(computerUseOutput), COMPUTER_RUN_WASM_NAME))
  const gatewayStoreWorkerInputs = await buildEntry(
    gatewayStoreWorkerEntryPath,
    gatewayStoreWorkerOutput,
    buildDefines,
    sdkExternalSpecifiers,
  )
  // #14616: the SDK's default account surface loads the plugin's thread client and device-account sidecars at run time
  // through the plugin manifest's import map, so neither is inlined into it; its send loads the wake sidecar the same way
  // to wake a parked session (#14972).
  const threadSdkInputs = await buildEntry(threadSdkEntryPath, threadSdkOutput, buildDefines, [
    ...sdkExternalSpecifiers,
    "#omo-thread-client-runtime",
    "#omo-device-account-runtime",
    "#omo-wake-runtime",
  ])
  // Bundling inlines assets.ts but its markdown is read from disk at runtime next to the bundle,
  // so the persona and the computer-use prelude are staged into the directory the loader runs from.
  await Promise.all([
    stageRuntimePersonas(repoRoot, dirname(output)),
    writeFile(join(dirname(output), COMPUTER_PRELUDE_ASSET_NAME), await readFile(computerPreludeAssetSource, "utf8")),
  ])
  return {
    mainInputs,
    taskInputs,
    memberInputs,
    supervisorInputs,
    advisorRuntimeInputs,
    sidePanelRuntimeInputs,
    onboardingScanRuntimeInputs,
    toolkitSdkInputs,
    bunshinTsInputs,
    sdkRuntimeInputs,
    rollbackRuntimeInputs,
    computerUseInputs,
    computerRunWorkerInputs,
    memoryDoctorInputs,
    memoryMemfsInputs,
    memoryPalaceInputs,
    deviceAccountInputs,
    memoryCommandsInputs,
    sessionHistoryInputs,
    recallStoreInputs,
    deviceServiceInputs,
    telemetryPosthogInputs,
    telemetryOtlpInputs,
    memorySyncInputs,
    threadClientInputs,
    wakeInputs,
    telemetryRecoveryInputs,
    feedbackInputs,
    desktopToolkitInputs,
    claimReceiptInputs,
    gatewayStoreWorkerInputs,
    threadSdkInputs,
  }
}

// `assets`: the entry imports files (the Loro wasm) through Bun's file loader, which is a second output
// that --outfile cannot write; --outdir with fixed names puts the entry at `output` and each asset beside it.
const rootRuntimeFile = (table = SDK_RUNTIME_FILES) => table.find((row) => !row.lazy)

/**
 * The one build of the SDK root runtime (`runtime/omo-sdk/sdk.js`). `keepMetafile` copies the bundler's metafile out
 * before it is removed: plugin/scripts/omo-sdk-static-set.mjs reads what this build keeps (#14950); `entry` lets its
 * control build one extra import on top of the same entry with the same settings.
 */
export function buildOmoSdkRuntime(output, buildDefines, { keepMetafile, entry } = {}) {
  return buildRuntimeFile(rootRuntimeFile(), output, buildDefines, { keepMetafile, entry })
}

/**
 * One SDK runtime file of the table, with that row's externals; `entry` overrides the row's entry for a control build.
 * `table` is the declaration the externals come from (a test passes a table with an added row).
 */
export function buildRuntimeFile(
  row,
  output,
  buildDefines,
  { keepMetafile, entry = resolve(packageRoot, row.entry), table = SDK_RUNTIME_FILES } = {},
) {
  return buildEntry(entry, output, buildDefines, runtimeFileExternals(row, table), { keepMetafile })
}

/**
 * Every SDK runtime file of `table` at `outputs[row.name]`, all with ONE build stamp (design lane ruling on PR 15116): a
 * digest of the build's defines and of every source any of the files is built from, so the same sources give the same
 * stamp (--check reproduces it) and a changed source gives a new one. The root compares it with what a loaded file
 * exports before using it. A first pass collects the sources; the second writes every file with the stamp.
 */
export async function buildSdkRuntimeFiles(outputs, buildDefines, table = SDK_RUNTIME_FILES) {
  const sources = new Set()
  for (const row of table)
    for (const input of await buildRuntimeFile(
      row,
      outputs[row.name],
      { ...buildDefines, OMO_SDK_RUNTIME_STAMP: "" },
      {
        table,
      },
    ))
      sources.add(input)
  const stamp = await sourceStamp([...sources].sort(), buildDefines)
  const inputs = {}
  for (const row of table)
    inputs[row.name] = await buildRuntimeFile(
      row,
      outputs[row.name],
      { ...buildDefines, OMO_SDK_RUNTIME_STAMP: stamp },
      {
        table,
      },
    )
  return inputs
}

async function sourceStamp(sources, buildDefines) {
  const hash = createHash("sha256").update(JSON.stringify(buildDefines))
  for (const source of sources)
    hash
      .update(toPortableBuildPath(source))
      .update("\0")
      .update(await readFile(resolve(repoRoot, source)))
  return hash.digest("base64url")
}

async function buildEntry(
  entry,
  output,
  buildDefines,
  externals = externalSpecifiers,
  { assets = false, keepMetafile } = {},
) {
  await mkdir(dirname(output), { recursive: true })
  const metafile = `${output}.meta.json`
  const target = assets
    ? ["--outdir", dirname(output), "--entry-naming", basename(output), "--asset-naming", "[name].[ext]"]
    : ["--outfile", output]
  try {
    runBuildCommand(resolveBunExecutable(), [
      "build",
      entry,
      "--target",
      "node",
      "--format",
      "esm",
      ...target,
      "--minify-syntax",
      "--minify-whitespace",
      `--metafile=${metafile}`,
      ...Object.entries(buildDefines).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]),
      ...externals.flatMap((specifier) => ["--external", specifier]),
    ])
    await normalizeBuiltinImports(output, builtinModuleNames)
    await minifyBundle(output)
    const inputs = await attachBuildMarker({
      output,
      entry,
      metafile,
      buildDefines,
      repoRoot,
      buildSettings: digestSettingsFor(externals, builtinModuleNames),
      buildScriptPath,
    })
    // Kept only for a build that succeeded, so a failed build's own error is what the caller sees.
    if (keepMetafile !== undefined) await copyFile(metafile, keepMetafile)
    return inputs
  } finally {
    await rm(metafile, { force: true })
  }
}

export function runBuildCommand(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
