import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const BUILD_MARKER_PREFIX = "// omo:"

export async function normalizeBuiltinImports(output, builtinModuleNames) {
  const bundled = await readFile(output, "utf8")
  const normalized = bundled.replace(
    /(from\s*["']|import\s*\(\s*["']|import\s*["'])([^"']+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      if (specifier.startsWith("node:")) return match
      if (!builtinModuleNames.includes(specifier)) return match
      return `${prefix}node:${specifier}${suffix}`
    },
  ).replace(/^[\t ]+$/gm, "")
  if (normalized !== bundled) await writeFile(output, normalized)
}

export async function attachBuildMarker(options) {
  const body = await readFile(options.output, "utf8")
  const metadata = JSON.parse(await readFile(options.metafile, "utf8"))
  const sourceDigest = await digestBuildSources(metadata, options)
  // Node's ESM loader only strips a shebang when it is the first bytes of the file, so an
  // executable bundle must keep it there and carry the marker on the line below. The digest still
  // covers the whole body, shebang included, so freshness is unaffected by where the marker sits.
  const marker = `${BUILD_MARKER_PREFIX}${sourceDigest}:${digest(body)}`
  const shebang = body.startsWith("#!") ? body.slice(0, body.indexOf("\n") + 1) : ""
  await writeFile(options.output, `${shebang}${marker}\n${body.slice(shebang.length)}`)
  return Object.keys(metadata.inputs ?? {})
}

async function digestBuildSources(metadata, options) {
  const inputs = metadata !== null && typeof metadata === "object" && metadata.inputs !== null
    && typeof metadata.inputs === "object" ? Object.keys(metadata.inputs).sort() : []
  const hash = createHash("sha256")
    .update(options.buildSettings)
    .update(JSON.stringify(options.buildDefines))
    .update(toPortableBuildPath(relative(options.repoRoot, options.entry)))
  for (const input of inputs) {
    const inputPath = resolve(options.repoRoot, input)
    hash.update(toPortableBuildPath(relative(options.repoRoot, inputPath))).update(await readFile(inputPath))
  }
  hash.update(await readFile(options.buildScriptPath))
  hash.update(await readFile(fileURLToPath(import.meta.url)))
  return hash.digest("base64url")
}

export function artifactsMatch(currentText, expectedText) {
  const current = parseBuildArtifact(currentText)
  const expected = parseBuildArtifact(expectedText)
  return current !== undefined && expected !== undefined
    && current.sourceDigest === expected.sourceDigest
    && current.bodyDigest === digest(current.body)
}

function parseBuildArtifact(text) {
  // Executable bundles keep the shebang at byte 0 (Node only strips it there) and carry the marker
  // on the line below, so the marker is not always the first line. The digested body is everything
  // except the marker line, shebang included, matching how attachBuildMarker composes the file.
  const offset = text.startsWith("#!") ? text.indexOf("\n") + 1 : 0
  if (offset < 0) return undefined
  const marked = text.slice(offset)
  const newline = marked.indexOf("\n")
  if (newline < 0) return undefined
  const match = /^\/\/ omo:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/.exec(marked.slice(0, newline))
  if (match === null) return undefined
  return {
    sourceDigest: match[1],
    bodyDigest: match[2],
    body: text.slice(0, offset) + marked.slice(newline + 1),
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("base64url")
}

export function toPortableBuildPath(path) {
  return path.replaceAll("\\", "/")
}
