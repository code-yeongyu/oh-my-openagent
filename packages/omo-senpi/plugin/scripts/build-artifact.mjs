import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { minify } from "terser"

const BUILD_MARKER_PREFIX = "// omo:"
const BUILD_ARTIFACT_PATH = fileURLToPath(import.meta.url)
const MINIFIER_IDLE_MS = 5_000

let minifierRequestId = 0
let nodeMinifier

export async function normalizeBuiltinImports(output, builtinModuleNames) {
  const bundled = await readFile(output, "utf8")
  const normalized = bundled
    .replace(/(from\s*["']|import\s*\(\s*["']|import\s*["'])([^"']+)(["'])/g, (match, prefix, specifier, suffix) => {
      if (specifier === "bun" || specifier.includes(":")) return match
      if (!builtinModuleNames.includes(specifier)) return match
      return `${prefix}node:${specifier}${suffix}`
    })
    .replace(/^[\t ]+$/gm, "")
  if (normalized !== bundled) await writeFile(output, normalized)
}

export async function minifyBundle(output) {
  if (process.versions.bun !== undefined) {
    await minifyBundleWithNode(output)
    return
  }
  await minifyBundleInProcess(output)
}

async function minifyBundleInProcess(output, destination = output) {
  const result = await minify(await readFile(output, "utf8"), {
    compress: true,
    mangle: true,
    module: true,
  })
  if (typeof result.code !== "string") {
    throw new Error(`Terser did not produce code for ${output}`)
  }
  await writeFile(destination, result.code)
}

function minifyBundleWithNode(output) {
  const id = ++minifierRequestId
  return new Promise((resolvePromise, reject) => {
    // The child writes beside the bundle and this process renames on its answer, so a child killed mid-write never
    // leaves a truncated bundle for the resend to minify.
    const minified = `${output}.minify-${id}.tmp`
    sendMinifyRequest({ id, output, minified, resolve: resolvePromise, reject, resent: false })
  })
}

// #13965: the shared child is process-wide, but a test runner's per-test timeout kills the processes that test
// started, and the first build to spawn the child is inside some test. One lost child used to reject every queued
// build. A request the lost child did not answer is now sent once to a fresh child; a request that loses a second
// child fails with that child's exit, so a minifier that dies for its own reasons is still reported. A request is lost
// either when the child exits before answering or when writing it to the child fails (a broken pipe can surface before
// the exit event); whichever path removes it from `pending` first recovers it, once.
function recoverUnanswered(request, reason) {
  rm(request.minified, { force: true }).then(() => {
    if (request.resent) request.reject(reason)
    else sendMinifyRequest({ ...request, resent: true })
  }, request.reject)
}

function sendMinifyRequest(request) {
  const minifier = getNodeMinifier()
  clearTimeout(minifier.idleTimer)
  minifier.pending.set(request.id, request)
  minifier.child.stdin.write(
    `${JSON.stringify({ id: request.id, output: request.output, minified: request.minified })}\n`,
    (error) => {
      if (error === null || error === undefined) return
      if (minifier.pending.delete(request.id)) recoverUnanswered(request, error)
    },
  )
}

function getNodeMinifier() {
  if (
    nodeMinifier !== undefined &&
    nodeMinifier.child.stdin.writable &&
    !nodeMinifier.child.stdin.writableEnded &&
    !nodeMinifier.child.stdin.destroyed
  )
    return nodeMinifier
  nodeMinifier = undefined
  const child = spawn("node", [BUILD_ARTIFACT_PATH, "--minify-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  })
  const pending = new Map()
  // A failed write is handled by its callback; without a listener the stream's own error event would be thrown.
  child.stdin.on("error", () => {})
  const lines = createInterface({ input: child.stdout })
  const minifier = { child, pending, idleTimer: undefined }
  nodeMinifier = minifier
  lines.on("line", (line) => {
    const response = JSON.parse(line)
    const request = pending.get(response.id)
    if (request === undefined) return
    pending.delete(response.id)
    if (response.error === undefined) rename(request.minified, request.output).then(request.resolve, request.reject)
    else rm(request.minified, { force: true }).then(() => request.reject(new Error(response.error)), request.reject)
    minifier.idleTimer = setTimeout(() => closeNodeMinifier(minifier), MINIFIER_IDLE_MS)
  })
  child.on("exit", (code, signal) => {
    clearTimeout(minifier.idleTimer)
    if (nodeMinifier === minifier) nodeMinifier = undefined
    const reason = new Error(
      `Node minifier exited before completing requests: code=${String(code)} signal=${String(signal)}`,
    )
    const unanswered = [...pending.values()]
    pending.clear()
    for (const request of unanswered) recoverUnanswered(request, reason)
  })
  return minifier
}

export function closeNodeMinifier(minifier = nodeMinifier) {
  if (minifier === undefined) return
  clearTimeout(minifier.idleTimer)
  if (nodeMinifier === minifier) nodeMinifier = undefined
  minifier.child.stdin.end()
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
  const inputs =
    metadata !== null && typeof metadata === "object" && metadata.inputs !== null && typeof metadata.inputs === "object"
      ? Object.keys(metadata.inputs).sort()
      : []
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
  return (
    current !== undefined &&
    expected !== undefined &&
    current.sourceDigest === expected.sourceDigest &&
    current.bodyDigest === digest(current.body) &&
    expected.bodyDigest === digest(expected.body) &&
    current.bodyDigest === expected.bodyDigest &&
    current.body === expected.body
  )
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

// Test seam (#13965): with OMO_MINIFY_SERVER_HOLD_REPLY set to a path, the server writes its pid there after
// minifying and never answers, so a test can kill a child that holds a finished but unanswered request on any OS.
// Unset or empty, it does nothing; only build-artifact.test.mjs sets it.
async function holdReplyForTest() {
  const holdPath = process.env.OMO_MINIFY_SERVER_HOLD_REPLY
  if (holdPath === undefined || holdPath === "") return
  await writeFile(holdPath, String(process.pid))
  await new Promise(() => {})
}

if (resolve(process.argv[1] ?? "") === resolve(BUILD_ARTIFACT_PATH)) {
  if (process.argv[2] === "--minify") {
    const output = process.argv[3]
    if (output === undefined) throw new Error("missing bundle path for --minify")
    await minifyBundleInProcess(output)
  } else if (process.argv[2] === "--minify-server") {
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
    for await (const line of lines) {
      const request = JSON.parse(line)
      try {
        await minifyBundleInProcess(request.output, request.minified)
        await holdReplyForTest()
        process.stdout.write(`${JSON.stringify({ id: request.id })}\n`)
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({ id: request.id, error: error instanceof Error ? error.message : String(error) })}\n`,
        )
      }
    }
  }
}
