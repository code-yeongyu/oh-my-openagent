#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
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
const builtinModuleNames = builtinModules.filter((moduleName) => !moduleName.startsWith("_"))
const externalSpecifiers = [
  ...SENPI_LOADER_ALIASES,
  ...builtinModuleNames,
  ...builtinModuleNames.map((moduleName) => `node:${moduleName}`),
]
const BUILD_MARKER_PREFIX = "// omo-senpi-build:"
const BUILD_SETTINGS = JSON.stringify({ target: "node", format: "esm", minify: true, externalSpecifiers })

export async function buildExtension(options = {}) {
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const mainInputs = await buildEntry(entryPath, output)
  const memberInputs = await buildEntry(memberEntryPath, memberOutput)
  return { mainInputs, memberInputs }
}

async function buildEntry(entry, output) {
  await mkdir(dirname(output), { recursive: true })
  const metafile = `${output}.meta.json`
  try {
    run("bun", [
      "build", entry, "--target", "node", "--format", "esm", "--outfile", output,
      "--minify", `--metafile=${metafile}`,
      ...externalSpecifiers.flatMap((specifier) => ["--external", specifier]),
    ])
    await normalizeBuiltinImports(output)
    return await attachBuildMarker(output, entry, metafile)
  } finally {
    await rm(metafile, { force: true })
  }
}

export async function checkExtensionCurrent(options = {}) {
  const output = options.outputPath ?? outputPath
  const memberOutput = options.memberOutputPath ?? (options.outputPath === undefined
    ? memberOutputPath
    : join(dirname(output), "omo-member.js"))
  const currentMain = await readBuiltEntry(output)
  if (currentMain === undefined) return { ok: false, reason: "missing-output", output }
  const currentMember = await readBuiltEntry(memberOutput)
  if (currentMember === undefined) return { ok: false, reason: "missing-output", output: memberOutput }

  const tempRoot = await mkdtemp(join(repoRoot, ".build-check-"))
  const expectedOutput = join(tempRoot, "omo.js")
  const expectedMemberOutput = join(tempRoot, "omo-member.js")
  try {
    await buildExtension({ outputPath: expectedOutput, memberOutputPath: expectedMemberOutput })
    if (!artifactsMatch(currentMain, await readFile(expectedOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output }
    }
    if (!artifactsMatch(currentMember, await readFile(expectedMemberOutput, "utf8"))) {
      return { ok: false, reason: "stale-output", output: memberOutput }
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
  // Whitespace-tolerant so minified output (`from"path"`, `import"path"`) normalizes too, not just the
  // spaced non-minified shape.
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

async function attachBuildMarker(output, entry, metafile) {
  const body = await readFile(output, "utf8")
  const metadata = JSON.parse(await readFile(metafile, "utf8"))
  const sourceDigest = await digestBuildSources(metadata, entry)
  await writeFile(output, `${BUILD_MARKER_PREFIX}${sourceDigest}:${digest(body)}\n${body}`)
  return Object.keys(metadata.inputs ?? {})
}

async function digestBuildSources(metadata, entry) {
  const inputs = metadata !== null && typeof metadata === "object" && metadata.inputs !== null
    && typeof metadata.inputs === "object" ? Object.keys(metadata.inputs).sort() : []
  const hash = createHash("sha256").update(BUILD_SETTINGS).update(relative(repoRoot, entry))
  for (const input of inputs) {
    const inputPath = resolve(repoRoot, input)
    hash.update(relative(repoRoot, inputPath)).update(await readFile(inputPath))
  }
  hash.update(await readFile(fileURLToPath(import.meta.url)))
  return hash.digest("hex")
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
  const match = /^\/\/ omo-senpi-build:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(text.slice(0, newline))
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
