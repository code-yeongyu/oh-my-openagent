#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { findStaleRuntimePersona, stageRuntimePersonas } from "./persona-artifacts.mjs"

import {
  artifactsMatch,
  attachBuildMarker,
  minifyBundle,
  normalizeBuiltinImports,
  toPortableBuildPath,
} from "./build-artifact.mjs"

export { toPortableBuildPath }

export function resolveBunExecutable(platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun"
}

// Keep this list byte-for-byte aligned with senpi loader.ts lines 145-165.
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
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = join(packageRoot, "..", "..")
const entryPath = join(packageRoot, "src", "extension", "bundled-index.ts")
const outputPath = join(pluginRoot, "extensions", "omo.js")
const taskEntryPath = join(packageRoot, "src", "extension", "omo-task.ts")
const taskOutputPath = join(pluginRoot, "extensions", "omo-task.js")
const memberEntryPath = join(repoRoot, "packages", "senpi-task", "src", "team", "member-extension", "index.ts")
const memberOutputPath = join(pluginRoot, "extensions", "omo-member.js")
const memoryMcpEntryPath = join(packageRoot, "src", "mcp", "memory-server.ts")
const memoryMcpOutputPath = join(pluginRoot, "extensions", "omo-memory-mcp.js")
const supervisorEntryPath = join(packageRoot, "src", "components", "memory", "worker", "memory-run-supervisor.ts")
const supervisorOutputPath = join(pluginRoot, "extensions", "memory-run-supervisor.mjs")
const advisorRuntimeEntryPath = join(packageRoot, "src", "components", "init-deep-advisor", "runtime.ts")
const advisorRuntimeOutputPath = join(pluginRoot, "extensions", "omo-init-deep-advisor.js")
const builtinModuleNames = builtinModules
  .filter((moduleName) => !moduleName.startsWith("_"))
  .sort()
const externalSpecifiers = [
  "#omo-task-runtime",
  ...SENPI_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]
const BUILD_SETTINGS = JSON.stringify({
  target: "node",
  format: "esm",
  minifySyntax: true,
  minifyWhitespace: true,
  minifyIdentifiers: false,
  secondaryMinifier: "terser@5.44.0",
  loaderAliases: SENPI_LOADER_ALIASES,
})

export async function buildExtension(options = {}) {
  const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("omo-senpi package manifest must contain a version")
  }
  const buildDefines = {
    OMO_SENPI_PACKAGE_VERSION: packageManifest.version,
    OMO_SENPI_BUNDLED: true,
  }
  const output = options.outputPath ?? outputPath
  const taskOutput = options.taskOutputPath ?? (options.outputPath === undefined
    ? taskOutputPath
    : join(dirname(output), "omo-task.js"))
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const memoryMcpOutput = options.memoryMcpOutputPath ?? (options.outputPath === undefined
    ? memoryMcpOutputPath
    : join(dirname(output), "omo-memory-mcp.js"))
  const supervisorOutput = options.supervisorOutputPath ?? (options.outputPath === undefined
    ? supervisorOutputPath
    : join(dirname(output), "memory-run-supervisor.mjs"))
  const advisorRuntimeOutput = options.advisorRuntimeOutputPath ?? (options.outputPath === undefined
    ? advisorRuntimeOutputPath
    : join(dirname(output), "omo-init-deep-advisor.js"))
  const mainInputs = await buildEntry(entryPath, output, buildDefines)
  const taskInputs = await buildEntry(taskEntryPath, taskOutput, buildDefines)
  const memberInputs = await buildEntry(memberEntryPath, memberOutput, buildDefines)
  const memoryMcpInputs = await buildEntry(memoryMcpEntryPath, memoryMcpOutput, buildDefines)
  const supervisorInputs = await buildEntry(supervisorEntryPath, supervisorOutput, buildDefines)
  const advisorRuntimeInputs = await buildEntry(advisorRuntimeEntryPath, advisorRuntimeOutput, buildDefines)
  // Bundling inlines assets.ts but its markdown is read from disk at runtime next to the bundle,
  // so the persona must be staged into the extension output directory the loader executes from.
  await Promise.all([
    stageRuntimePersonas(repoRoot, dirname(output)),
  ])
  return { mainInputs, taskInputs, memberInputs, memoryMcpInputs, supervisorInputs, advisorRuntimeInputs }
}

async function buildEntry(entry, output, buildDefines) {
  await mkdir(dirname(output), { recursive: true })
  const metafile = `${output}.meta.json`
  try {
    run(resolveBunExecutable(), [
      "build", entry, "--target", "node", "--format", "esm", "--outfile", output,
      "--minify-syntax", "--minify-whitespace", `--metafile=${metafile}`,
      ...Object.entries(buildDefines).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]),
      ...externalSpecifiers.flatMap((specifier) => ["--external", specifier]),
    ])
    await normalizeBuiltinImports(output, builtinModuleNames)
    await minifyBundle(output)
    return await attachBuildMarker({
      output,
      entry,
      metafile,
      buildDefines,
      repoRoot,
      buildSettings: BUILD_SETTINGS,
      buildScriptPath: fileURLToPath(import.meta.url),
    })
  } finally {
    await rm(metafile, { force: true })
  }
}

export async function checkExtensionCurrent(options = {}) {
  const output = options.outputPath ?? outputPath
  const taskOutput = options.taskOutputPath ?? (options.outputPath === undefined
    ? taskOutputPath
    : join(dirname(output), "omo-task.js"))
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const memoryMcpOutput = options.memoryMcpOutputPath ?? (options.outputPath === undefined
    ? memoryMcpOutputPath
    : join(dirname(output), "omo-memory-mcp.js"))
  const supervisorOutput = options.supervisorOutputPath ?? (options.outputPath === undefined
    ? supervisorOutputPath
    : join(dirname(output), "memory-run-supervisor.mjs"))
  const advisorRuntimeOutput = options.advisorRuntimeOutputPath ?? (options.outputPath === undefined
    ? advisorRuntimeOutputPath
    : join(dirname(output), "omo-init-deep-advisor.js"))
  const currentMain = await readBuiltEntry(output)
  if (currentMain === undefined) return { ok: false, reason: "missing-output", output }
  const currentTask = await readBuiltEntry(taskOutput)
  if (currentTask === undefined) return { ok: false, reason: "missing-output", output: taskOutput }
  const currentMember = await readBuiltEntry(memberOutput)
  if (currentMember === undefined) return { ok: false, reason: "missing-output", output: memberOutput }
  const currentMemoryMcp = await readBuiltEntry(memoryMcpOutput)
  if (currentMemoryMcp === undefined) return { ok: false, reason: "missing-output", output: memoryMcpOutput }
  const currentSupervisor = await readBuiltEntry(supervisorOutput)
  if (currentSupervisor === undefined) return { ok: false, reason: "missing-output", output: supervisorOutput }
  const currentAdvisorRuntime = await readBuiltEntry(advisorRuntimeOutput)
  if (currentAdvisorRuntime === undefined) {
    return { ok: false, reason: "missing-output", output: advisorRuntimeOutput }
  }

  const tempRoot = await mkdtemp(join(repoRoot, ".build-check-"))
  const expectedOutput = join(tempRoot, "omo.js")
  const expectedTaskOutput = join(tempRoot, "omo-task.js")
  const expectedMemberOutput = join(tempRoot, "omo-member.js")
  const expectedMemoryMcpOutput = join(tempRoot, "omo-memory-mcp.js")
  const expectedSupervisorOutput = join(tempRoot, "memory-run-supervisor.mjs")
  const expectedAdvisorRuntimeOutput = join(tempRoot, "omo-init-deep-advisor.js")
  try {
    await buildExtension({
      outputPath: expectedOutput,
      taskOutputPath: expectedTaskOutput,
      memberOutputPath: expectedMemberOutput,
      memoryMcpOutputPath: expectedMemoryMcpOutput,
      supervisorOutputPath: expectedSupervisorOutput,
      advisorRuntimeOutputPath: expectedAdvisorRuntimeOutput,
    })
    if (!artifactsMatch(currentMain, await readFile(expectedOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output }
    }
    if (!artifactsMatch(currentTask, await readFile(expectedTaskOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: taskOutput }
    }
    if (!artifactsMatch(currentMember, await readFile(expectedMemberOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: memberOutput }
    }
    if (!artifactsMatch(currentMemoryMcp, await readFile(expectedMemoryMcpOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: memoryMcpOutput }
    }
    if (!artifactsMatch(currentSupervisor, await readFile(expectedSupervisorOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: supervisorOutput }
    }
    if (!artifactsMatch(currentAdvisorRuntime, await readFile(expectedAdvisorRuntimeOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: advisorRuntimeOutput }
    }
    const stalePersona = await findStaleRuntimePersona(tempRoot, dirname(output), repoRoot)
    if (stalePersona !== undefined) return { ok: false, reason: "stale-output", output: stalePersona }
    return { ok: true, output, taskOutput, memberOutput, advisorRuntimeOutput }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

async function digestBuildSources(metadata, entry, buildDefines) {
  const inputs = metadata !== null && typeof metadata === "object" && metadata.inputs !== null
    && typeof metadata.inputs === "object" ? Object.keys(metadata.inputs).sort() : []
  const hash = createHash("sha256")
    .update(BUILD_SETTINGS)
    .update(JSON.stringify(buildDefines))
    .update(toPortableBuildPath(relative(repoRoot, entry)))
  for (const input of inputs) {
    const inputPath = resolve(repoRoot, input)
    hash.update(toPortableBuildPath(relative(repoRoot, inputPath))).update(await readFile(inputPath))
  }
  hash.update(await readFile(fileURLToPath(import.meta.url)))
  return hash.digest("hex")
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

async function readBuiltEntry(output) {
  try {
    return await readFile(output, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined
    throw error
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    run("node", [join(scriptDir, "stage-lsp-daemon-runtime.mjs"), "--check"])
    run("node", [join(scriptDir, "stage-ast-grep-mcp-runtime.mjs"), "--check"])
    run("node", [join(scriptDir, "stage-agent-toolkit.mjs"), "--check"])
    const result = await checkExtensionCurrent()
    if (!result.ok) {
      console.error(`omo-senpi extension build is not current: ${result.reason}`)
      console.error(`output=${result.output}`)
      process.exit(1)
    }
    console.log(`omo-senpi extension build is current: ${result.output}`)
  } else {
    await buildExtension()
    console.log(
      `Built omo-senpi extensions: ${outputPath}, ${taskOutputPath}, ${memberOutputPath}, ${memoryMcpOutputPath}, ${supervisorOutputPath}, ${advisorRuntimeOutputPath}`,
    )
  }
}
