#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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
const entryPath = join(packageRoot, "src", "extension", "index.ts")
const outputPath = join(pluginRoot, "extensions", "omo.js")
const memberEntryPath = join(repoRoot, "packages", "senpi-task", "src", "team", "member-extension", "index.ts")
const memberOutputPath = join(pluginRoot, "extensions", "omo-member.js")
const sourceRoots = [join(packageRoot, "src", "extension"), join(packageRoot, "src", "components")]
const memberSourceRoots = [join(repoRoot, "packages", "senpi-task", "src", "team", "member-extension")]
const builtinModuleNames = builtinModules.filter((moduleName) => !moduleName.startsWith("_"))
const externalSpecifiers = [
  ...SENPI_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]

export async function buildExtension(options = {}) {
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  await buildEntry(entryPath, output)
  await buildEntry(memberEntryPath, memberOutput)
}

async function buildEntry(entry, output) {
  await mkdir(dirname(output), { recursive: true })
  run("bun", [
    "build",
    entry,
    "--target",
    "node",
    "--format",
    "esm",
    "--outfile",
    output,
    "--minify",
    ...externalSpecifiers.flatMap((specifier) => ["--external", specifier]),
  ])
  await normalizeBuiltinImports(output)
}

export async function checkExtensionCurrent(options = {}) {
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const mainResult = await checkBuiltEntry(output, sourceRoots)
  if (!mainResult.ok) return mainResult
  const memberResult = await checkBuiltEntry(memberOutput, memberSourceRoots)
  if (!memberResult.ok) return memberResult
  return { ok: true, output, memberOutput }
}

async function checkBuiltEntry(output, roots) {
  let outputStats
  try {
    outputStats = await stat(output)
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { ok: false, reason: "missing-output", output }
    throw error
  }

  const latestSource = await latestMtimeMs(roots)
  if (latestSource > outputStats.mtimeMs) {
    return { ok: false, reason: "stale-output", output, latestSource, outputMtime: outputStats.mtimeMs }
  }

  return { ok: true, output }
}

async function latestMtimeMs(paths) {
  let latest = 0
  for (const path of paths) {
    const pathStats = await stat(path)
    latest = Math.max(latest, pathStats.mtimeMs)
    if (!pathStats.isDirectory()) continue
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      latest = Math.max(latest, await latestMtimeMs([join(path, entry.name)]))
    }
  }
  return latest
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

async function normalizeBuiltinImports(output) {
  const bundled = await readFile(output, "utf8")
  // Whitespace-tolerant so minified output (`from"path"`, `import"path"`) normalizes too, not just the
  // spaced non-minified shape.
  const normalized = bundled.replace(
    /(from\s*["']|import\s*\(\s*["']|import\s*["'])([^"']+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      if (specifier.startsWith("node:")) return match
      if (!builtinModuleNames.includes(specifier)) return match
      return `${prefix}node:${specifier}${suffix}`
    },
  )
  if (normalized !== bundled) {
    await writeFile(output, normalized)
  }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const result = await checkExtensionCurrent()
    if (!result.ok) {
      console.error(`omo-senpi extension build is not current: ${result.reason}`)
      console.error(`output=${result.output}`)
      process.exit(1)
    }
    console.log(`omo-senpi extension build is current: ${result.output}`)
  } else {
    await buildExtension()
    console.log(`Built omo-senpi extensions: ${outputPath}, ${memberOutputPath}`)
  }
}
