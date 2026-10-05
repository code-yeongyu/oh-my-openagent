import { spawnSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  attachBuildMarker,
  minifyBundle,
  normalizeBuiltinImports,
} from "./build-artifact.mjs"
import { stageRuntimePersonas } from "./persona-artifacts.mjs"

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
const outputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
  ? join(pluginRoot, "extensions", "omo.js")
  : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo.js")
const taskEntryPath = join(packageRoot, "src", "extension", "omo-task.ts")
const taskOutputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined ? join(pluginRoot, "extensions", "omo-task.js") : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-task.js")
const memberEntryPath = join(repoRoot, "packages", "senpi-task", "src", "team", "member-extension", "index.ts")
const memberOutputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined ? join(pluginRoot, "extensions", "omo-member.js") : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-member.js")
const supervisorEntryPath = join(packageRoot, "src", "components", "memory", "worker", "memory-run-supervisor.ts")
const supervisorOutputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined ? join(pluginRoot, "extensions", "memory-run-supervisor.mjs") : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "memory-run-supervisor.mjs")
// The thread gateway's store runs in a worker thread (`new Worker(url)`), which a bundler cannot
// inline, so it ships as its own entry beside omo.js; `gateway/store.ts` resolves this name from
// its own module location and falls back to `store-worker.ts` in source.
export const GATEWAY_STORE_WORKER_NAME = "gateway-store-worker.mjs"
const gatewayStoreWorkerEntryPath = join(packageRoot, "src", "components", "thread", "gateway", "store-worker.ts")
const gatewayStoreWorkerOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", GATEWAY_STORE_WORKER_NAME)
// The gateway_rules store extension's ops module is imported by the store worker through a file
// URL, so it ships as its own entry beside omo.js; the gateway component resolves this name.
export const GATEWAY_RULES_EXTENSION_NAME = "gateway-rules-extension.mjs"
const gatewayRulesExtensionEntryPath = join(packageRoot, "src", "components", "gateway", "store-extension", "index.ts")
const gatewayRulesExtensionOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", GATEWAY_RULES_EXTENSION_NAME)
const toolkitSdkEntryPath = join(packageRoot, "src", "extension", "agent-toolkit-sdk.ts")
const toolkitSdkOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "runtime", "agent-toolkit-sdk", "sdk.js")
// The `omo thread` CLI and connector scripts import this SDK without an agent session; it points
// the gateway store at the worker sidecar in `extensions/` (two levels up from its own file).
export const THREAD_SDK_RELATIVE_PATH = join("runtime", "thread-sdk", "sdk.js")
const threadSdkEntryPath = join(packageRoot, "src", "extension", "thread-sdk.ts")
const threadSdkOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, THREAD_SDK_RELATIVE_PATH)
const advisorRuntimeEntryPath = join(packageRoot, "src", "components", "init-deep-advisor", "runtime.ts")
const advisorRuntimeOutputPath = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined ? join(pluginRoot, "extensions", "omo-init-deep-advisor.js") : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "extensions", "omo-init-deep-advisor.js")
const computerUseEntryPath = join(packageRoot, "src", "components", "computer-use", "runtime.ts")
const computerUseOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-computer-use.js")
const memoryDoctorEntryPath = join(packageRoot, "src", "components", "memory", "commands", "doctor-runtime.ts")
const memoryMemfsEntryPath = join(packageRoot, "src", "components", "memory", "commands", "memfs-runtime.ts")
const threadClientEntryPath = join(packageRoot, "src", "components", "thread", "live-surface.ts")
const memoryDoctorOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-memory-doctor.js")
const memoryMemfsOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-memory-memfs.js")
const threadClientOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "extensions", "omo-thread-client.js")
// The computer-use prelude JSON: bundled modules read it from beside the bundle (extensions/), the
// same contract as the staged personas, so omo.js carries none of the ~29 KB of prelude text (#9113).
export const COMPUTER_PRELUDE_ASSET_NAME = "assets.generated.json"
const computerPreludeAssetSource = join(repoRoot, "packages", "senpi-desktop-prelude", "src", "assets.generated.json")
const rollbackRuntimeEntryPath = join(packageRoot, "src", "extension", "rollback-migrate-runtime.ts")
const rollbackRuntimeOutputPath = join(process.env.OMO_SENPI_PLUGIN_OUTPUT ?? pluginRoot, "runtime", "rollback-migrate.js")
const builtinModuleNames = builtinModules.filter((moduleName) => !moduleName.startsWith("_")).sort()
const externalSpecifiers = [
  "#omo-task-runtime",
  "#omo-computer-use-runtime",
  "#omo-memory-doctor-runtime",
  "#omo-memory-memfs-runtime",
  "#omo-thread-client-runtime",
  "#omo-agent-toolkit-sdk",
  ...SENPI_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]
const sdkExternalSpecifiers = [...builtinModuleNames, ...builtinModuleNames.map(name => `node:${name}`)]
const BUILD_SETTINGS = JSON.stringify({
  target: "node",
  format: "esm",
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  secondaryMinifier: "terser@5.44.0",
  loaderAliases: SENPI_LOADER_ALIASES,
})

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
  threadSdkOutputPath,
  advisorRuntimeOutputPath,
  rollbackRuntimeOutputPath,
  computerUseOutputPath,
  memoryDoctorOutputPath,
  memoryMemfsOutputPath,
  threadClientOutputPath,
  gatewayStoreWorkerOutputPath,
  gatewayRulesExtensionOutputPath,
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
    advisorRuntimeOutput: sibling(options.advisorRuntimeOutputPath, advisorRuntimeOutputPath, "omo-init-deep-advisor.js"),
    toolkitSdkOutput: sibling(options.toolkitSdkOutputPath, toolkitSdkOutputPath, join("runtime", "agent-toolkit-sdk", "sdk.js")),
    threadSdkOutput: sibling(options.threadSdkOutputPath, threadSdkOutputPath, THREAD_SDK_RELATIVE_PATH),
    rollbackRuntimeOutput: sibling(options.rollbackRuntimeOutputPath, rollbackRuntimeOutputPath, join("runtime", "rollback-migrate.js")),
    memoryDoctorOutput: sibling(options.memoryDoctorOutputPath, memoryDoctorOutputPath, "omo-memory-doctor.js"),
    memoryMemfsOutput: sibling(options.memoryMemfsOutputPath, memoryMemfsOutputPath, "omo-memory-memfs.js"),
    threadClientOutput: sibling(options.threadClientOutputPath, threadClientOutputPath, "omo-thread-client.js"),
    computerUseOutput: sibling(options.computerUseOutputPath, computerUseOutputPath, "omo-computer-use.js"),
    gatewayStoreWorkerOutput: sibling(options.gatewayStoreWorkerOutputPath, gatewayStoreWorkerOutputPath, GATEWAY_STORE_WORKER_NAME),
    gatewayRulesExtensionOutput: sibling(options.gatewayRulesExtensionOutputPath, gatewayRulesExtensionOutputPath, GATEWAY_RULES_EXTENSION_NAME),
  }
}

export async function buildExtension(options = {}) {
  const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("omo-senpi package manifest must contain a version")
  }
  const buildDefines = {
    OMO_SENPI_PACKAGE_VERSION: packageManifest.version,
    OMO_SENPI_BUNDLED: true,
  }
  const {
    output,
    taskOutput,
    memberOutput,
    supervisorOutput,
    advisorRuntimeOutput,
    toolkitSdkOutput,
    threadSdkOutput,
    rollbackRuntimeOutput,
    computerUseOutput,
    memoryDoctorOutput,
    memoryMemfsOutput,
    threadClientOutput,
    gatewayStoreWorkerOutput,
    gatewayRulesExtensionOutput,
  } = resolveOutputs(options)
  const toolkitSdkInputs = await buildEntry(toolkitSdkEntryPath, toolkitSdkOutput, buildDefines, sdkExternalSpecifiers)
  const mainInputs = await buildEntry(entryPath, output, buildDefines)
  const taskInputs = await buildEntry(taskEntryPath, taskOutput, buildDefines)
  const memberInputs = await buildEntry(memberEntryPath, memberOutput, buildDefines)
  const supervisorInputs = await buildEntry(supervisorEntryPath, supervisorOutput, buildDefines)
  const advisorRuntimeInputs = await buildEntry(advisorRuntimeEntryPath, advisorRuntimeOutput, buildDefines)
  const rollbackRuntimeInputs = await buildEntry(rollbackRuntimeEntryPath, rollbackRuntimeOutput, buildDefines, sdkExternalSpecifiers)
  const memoryDoctorInputs = await buildEntry(memoryDoctorEntryPath, memoryDoctorOutput, buildDefines)
  const memoryMemfsInputs = await buildEntry(memoryMemfsEntryPath, memoryMemfsOutput, buildDefines)
  const threadClientInputs = await buildEntry(threadClientEntryPath, threadClientOutput, buildDefines)
  const computerUseInputs = await buildEntry(computerUseEntryPath, computerUseOutput, buildDefines)
  const gatewayStoreWorkerInputs = await buildEntry(gatewayStoreWorkerEntryPath, gatewayStoreWorkerOutput, buildDefines, sdkExternalSpecifiers)
  const gatewayRulesExtensionInputs = await buildEntry(gatewayRulesExtensionEntryPath, gatewayRulesExtensionOutput, buildDefines)
  const threadSdkInputs = await buildEntry(threadSdkEntryPath, threadSdkOutput, buildDefines, sdkExternalSpecifiers)
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
    toolkitSdkInputs,
    rollbackRuntimeInputs,
    computerUseInputs,
    memoryDoctorInputs,
    memoryMemfsInputs,
    threadClientInputs,
    gatewayStoreWorkerInputs,
    gatewayRulesExtensionInputs,
    threadSdkInputs,
  }
}

async function buildEntry(entry, output, buildDefines, externals = externalSpecifiers) {
  await mkdir(dirname(output), { recursive: true })
  const metafile = `${output}.meta.json`
  try {
    runBuildCommand(resolveBunExecutable(), [
      "build", entry, "--target", "node", "--format", "esm", "--outfile", output,
      "--minify-syntax", "--minify-whitespace", `--metafile=${metafile}`,
      ...Object.entries(buildDefines).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]),
      ...externals.flatMap((specifier) => ["--external", specifier]),
    ])
    await normalizeBuiltinImports(output, builtinModuleNames)
    await minifyBundle(output)
    return await attachBuildMarker({
      output,
      entry,
      metafile,
      buildDefines,
      repoRoot,
      buildSettings: JSON.stringify({ settings: BUILD_SETTINGS, externals }),
      buildScriptPath,
    })
  } finally {
    await rm(metafile, { force: true })
  }
}

export function runBuildCommand(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
