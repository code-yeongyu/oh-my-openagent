#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Keep this list byte-for-byte aligned with the omp loader's typebox shim surface.
// The omo-omp adapter source imports ZERO @oh-my-pi/* modules at runtime (the harness
// hands the extension its live API object as the factory argument), so the only
// externalized peers are the typebox family the omp host injects.
export const OMP_LOADER_ALIASES = [
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
const memberEntryPath = join(packageRoot, "src", "team", "member-extension", "index.ts")
const memberOutputPath = join(pluginRoot, "extensions", "omo-member.js")
const memoryMcpEntryPath = join(packageRoot, "src", "mcp", "memory-server.ts")
const memoryMcpOutputPath = join(pluginRoot, "extensions", "omo-memory-mcp.js")
const builtinModuleNames = builtinModules
  .filter((moduleName) => !moduleName.startsWith("_"))
  .sort()
const externalSpecifiers = [
  ...OMP_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]
const BUILD_MARKER_PREFIX = "// omo-omp-build:"
const BUILD_SETTINGS = JSON.stringify({
  target: "node",
  format: "esm",
  minify: true,
  loaderAliases: OMP_LOADER_ALIASES,
})

export async function buildExtension(options = {}) {
  const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
  if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
    throw new Error("omo-omp package manifest must contain a version")
  }
  const buildDefines = { OMO_OMP_PACKAGE_VERSION: packageManifest.version }
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const memoryMcpOutput = options.memoryMcpOutputPath ?? (options.outputPath === undefined
    ? memoryMcpOutputPath
    : join(dirname(output), "omo-memory-mcp.js"))
  const mainInputs = await buildEntry(entryPath, output, buildDefines)
  // The member extension and memory MCP server ship when their entries exist.
  const memberInputs = existsSync(memberEntryPath)
    ? await buildEntry(memberEntryPath, memberOutput, buildDefines)
    : []
  const memoryMcpInputs = existsSync(memoryMcpEntryPath)
    ? await buildEntry(memoryMcpEntryPath, memoryMcpOutput, buildDefines)
    : []
  return { mainInputs, memberInputs, memoryMcpInputs }
}

async function buildEntry(entry, output, buildDefines) {
  await mkdir(dirname(output), { recursive: true })
  const metafile = `${output}.meta.json`
  try {
    run("bun", [
      "build", entry, "--target", "node", "--format", "esm", "--outfile", output,
      "--minify", `--metafile=${metafile}`,
      ...Object.entries(buildDefines).flatMap(([name, value]) => ["--define", `${name}=${JSON.stringify(value)}`]),
      ...externalSpecifiers.flatMap((specifier) => ["--external", specifier]),
    ])
    await normalizeBuiltinImports(output)
    return await attachBuildMarker(output, entry, metafile, buildDefines)
  } finally {
    await rm(metafile, { force: true })
  }
}

export async function checkExtensionCurrent(options = {}) {
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const memoryMcpOutput = options.memoryMcpOutputPath ?? (options.outputPath === undefined
    ? memoryMcpOutputPath
    : join(dirname(output), "omo-memory-mcp.js"))
  const currentMain = await readBuiltEntry(output)
  if (currentMain === undefined) return { ok: false, reason: "missing-output", output }

  const tempRoot = await mkdtemp(join(repoRoot, ".build-check-"))
  const expectedOutput = join(tempRoot, "omo.js")
  try {
    await buildExtension({ outputPath: expectedOutput, memberOutputPath: join(tempRoot, "omo-member.js"), memoryMcpOutputPath: join(tempRoot, "omo-memory-mcp.js") })
    if (!artifactsMatch(currentMain, await readFile(expectedOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output }
    }
    const currentMember = await readBuiltEntry(memberOutput)
    if (currentMember !== undefined && !artifactsMatch(currentMember, await readFile(join(tempRoot, "omo-member.js"), "utf8"))) {
      return { ok: false, reason: "stale-output", output: memberOutput }
    }
    const currentMemoryMcp = await readBuiltEntry(memoryMcpOutput)
    if (currentMemoryMcp !== undefined && !artifactsMatch(currentMemoryMcp, await readFile(join(tempRoot, "omo-memory-mcp.js"), "utf8"))) {
      return { ok: false, reason: "stale-output", output: memoryMcpOutput }
    }
    return { ok: true, output, memberOutput }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
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
  const normalized = bundled.replace(
    /(from\s*["']|import\s*\(\s*["']|import\s*["'])([^"']+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      if (specifier.startsWith("node:")) return match
      if (!builtinModuleNames.includes(specifier)) return match
      return `${prefix}node:${specifier}${suffix}`
    },
  ).replace(/^[\t ]+$/gm, "")
  if (normalized !== bundled) {
    await writeFile(output, normalized)
  }
}

async function attachBuildMarker(output, entry, metafile, buildDefines) {
  const body = await readFile(output, "utf8")
  const metadata = JSON.parse(await readFile(metafile, "utf8"))
  const sourceDigest = await digestBuildSources(metadata, entry, buildDefines)
  await writeFile(output, `${BUILD_MARKER_PREFIX}${sourceDigest}:${digest(body)}\n${body}`)
  return Object.keys(metadata.inputs ?? {})
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

export function toPortableBuildPath(path) {
  return path.replaceAll("\\", "/")
}

function artifactsMatch(currentText, expectedText) {
  const current = parseBuildArtifact(currentText)
  const expected = parseBuildArtifact(expectedText)
  return current !== undefined && expected !== undefined
    && current.sourceDigest === expected.sourceDigest
    && current.bodyDigest === digest(current.body)
}

function parseBuildArtifact(text) {
  const newline = text.indexOf("\n")
  if (newline < 0) return undefined
  const match = /^\/\/ omo-omp-build:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(text.slice(0, newline))
  if (match === null) return undefined
  return { sourceDigest: match[1], bodyDigest: match[2], body: text.slice(newline + 1) }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex")
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
    const result = await checkExtensionCurrent()
    if (!result.ok) {
      console.error(`omo-omp extension build is not current: ${result.reason}`)
      console.error(`output=${result.output}`)
      process.exit(1)
    }
    console.log(`omo-omp extension build is current: ${result.output}`)
  } else {
    await buildExtension()
    console.log(`Built omo-omp extensions: ${outputPath}`)
  }
}
