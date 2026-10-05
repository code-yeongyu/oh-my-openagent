#!/usr/bin/env bun
// Packaging guard for the resident Kibitzer sidecar: proves, WITHOUT starting the binary, that the
// shipped plugin artifact carries the sidecar entry, the Kibitzer persona asset, exactly the five
// read-only tool closures (no aliases) and the runtime dependency the child starter imports.
//
// This is the manifest/source-digest control of the packaging lane; the independent recovery
// control (kibitzer-sidecar-recovery-probe.mjs) starts the packaged binary and exercises one wake.
// Every finding here is recorded with layer "manifest" so the two never blur. Identifiers in the
// bundle are minified, so the proof rests on string literals the build cannot rename: the tool
// registry array, the tool labels, the envelope tags, the sidecar directory segment, the lock domain
// and the persona filename.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")

export const LAYER = "manifest"
export const DEFAULT_PLUGIN_ROOT = join(packageRoot, "plugin")
export const DEFAULT_EXPECTED_TOOLS = ["read", "grep", "session_entries", "memory", "nudge"]
export const DEFAULT_FORBIDDEN_ALIASES = ["memory_read", "memory_search", "memory_write", "bash", "edit", "write", "find", "ls"]
export const PERSONA_ASSET = "kibitzer-persona.md"
export const PERSONA_SOURCE = join("packages", "memory-core", "src", "recall", "assets", PERSONA_ASSET)
export const TASK_RUNTIME_SPECIFIER = "#omo-task-runtime"

/** One literal per closure: the label (or, for nudge, the description head) the closure is registered with. */
export const TOOL_CLOSURE_MARKERS = {
  read: 'label:"Kibitzer read"',
  grep: 'label:"Kibitzer grep"',
  session_entries: 'label:"Kibitzer session"',
  memory: 'label:"Kibitzer memory"',
  nudge: "Surface one stored memory to the primary agent as a read-only hint",
}

/** Literals of the resident lifecycle that only exist in the sidecar composition. */
export const SIDECAR_ENTRY_MARKERS = {
  "seed-envelope": '"kibitzer-seed"',
  "wake-envelope": '"kibitzer-wake"',
  "reseed-envelope": '"kibitzer-reseed"',
  "sidecar-directory": '"sidecars"',
  "wake-lock-domain": "recall-wake",
  "sidecar-start-error": "Kibitzer sidecar model unavailable",
  "nudged-entry-type": "omo-kibitzer:nudged",
  "memory-read-only-operations": '["search","read"]',
  "memory-tool-cannot-write": "This tool cannot write",
}

export function parseArgs(argv) {
  const options = {
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    source: repoRoot,
    evidenceDir: undefined,
    expectTools: DEFAULT_EXPECTED_TOOLS,
    forbidAliases: DEFAULT_FORBIDDEN_ALIASES,
    removeSidecarAsset: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--plugin-root") options.pluginRoot = resolve(take())
    else if (arg === "--source") options.source = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--expect-tools") options.expectTools = take().split(",").map((name) => name.trim()).filter((name) => name.length > 0)
    else if (arg === "--forbid-aliases") options.forbidAliases = take().split(",").map((name) => name.trim()).filter((name) => name.length > 0)
    else if (arg === "--remove-sidecar-asset") options.removeSidecarAsset = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function describeFile(path) {
  if (!existsSync(path)) return { path, present: false }
  const buffer = readFileSync(path)
  return { path, present: true, bytes: buffer.length, sha256: sha256(buffer) }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return undefined }
}

/**
 * Runs every manifest check against `pluginRoot`. Pure over the filesystem: it reads, hashes and
 * searches; it never executes anything from the plugin. Returns the manifest payload.
 */
export function checkManifest({ pluginRoot, source, expectTools, forbidAliases }) {
  const checks = []
  const reasons = []
  const record = (name, ok, detail, reason) => {
    checks.push({ layer: LAYER, name, ok, detail })
    if (!ok && reason !== undefined) reasons.push(reason)
    return ok
  }

  const extensions = join(pluginRoot, "extensions")
  const bundlePath = join(extensions, "omo.js")
  const taskRuntimePath = join(extensions, "omo-task.js")
  const personaPath = join(extensions, PERSONA_ASSET)
  const manifestPath = join(pluginRoot, "package.json")
  const artifacts = {
    "omo.js": describeFile(bundlePath),
    "omo-task.js": describeFile(taskRuntimePath),
    [PERSONA_ASSET]: describeFile(personaPath),
    "package.json": describeFile(manifestPath),
  }
  const bundle = artifacts["omo.js"].present ? readFileSync(bundlePath, "utf8") : ""
  const taskRuntime = artifacts["omo-task.js"].present ? readFileSync(taskRuntimePath, "utf8") : ""
  const marker = bundle.split("\n", 1)[0] ?? ""

  // ---- the artifact and its runtime dependency -------------------------------------------------------
  record("artifact.bundle-present", artifacts["omo.js"].present && artifacts["omo.js"].bytes > 0, `omo.js bytes=${artifacts["omo.js"].bytes ?? 0} sha256=${artifacts["omo.js"].sha256 ?? "none"}`, "missing-bundle")
  record("artifact.build-marker", marker.startsWith("// omo:"), `marker=${JSON.stringify(marker.slice(0, 120))}`, "missing-build-marker")
  const manifest = readJson(manifestPath)
  const registeredExtensions = Array.isArray(manifest?.pi?.extensions) ? manifest.pi.extensions : []
  record("artifact.extension-registered", registeredExtensions.includes("./extensions/omo.js"), `pi.extensions=${JSON.stringify(registeredExtensions)}`, "extension-not-registered")
  const taskRuntimeMapping = manifest?.imports?.[TASK_RUNTIME_SPECIFIER]
  record("artifact.task-runtime-mapped", taskRuntimeMapping === "./extensions/omo-task.js" && artifacts["omo-task.js"].present && artifacts["omo-task.js"].bytes > 0, `imports[${TASK_RUNTIME_SPECIFIER}]=${JSON.stringify(taskRuntimeMapping)} omo-task.js bytes=${artifacts["omo-task.js"].bytes ?? 0}`, "missing-task-runtime")
  record("artifact.task-runtime-imported", bundle.includes(TASK_RUNTIME_SPECIFIER), `omo.js references ${TASK_RUNTIME_SPECIFIER}=${bundle.includes(TASK_RUNTIME_SPECIFIER)}`, "sidecar-runtime-import-missing")
  record("artifact.task-runtime-exports-runner", taskRuntime.includes("createInProcessJudgeRunner") && taskRuntime.includes("findModelReference"), `omo-task.js exports createInProcessJudgeRunner=${taskRuntime.includes("createInProcessJudgeRunner")} findModelReference=${taskRuntime.includes("findModelReference")}`, "in-process-runner-missing")

  // ---- the persona asset -------------------------------------------------------------------------------------
  const personaSource = describeFile(join(source, PERSONA_SOURCE))
  record("persona.staged", artifacts[PERSONA_ASSET].present && artifacts[PERSONA_ASSET].bytes > 0, `${PERSONA_ASSET} present=${artifacts[PERSONA_ASSET].present} bytes=${artifacts[PERSONA_ASSET].bytes ?? 0}`, "missing-asset")
  record("persona.matches-source", personaSource.present && artifacts[PERSONA_ASSET].present && personaSource.sha256 === artifacts[PERSONA_ASSET].sha256, `staged=${artifacts[PERSONA_ASSET].sha256 ?? "none"} source=${personaSource.sha256 ?? "none"} (${personaSource.path})`, "persona-stale")
  record("persona.referenced-by-bundle", bundle.includes(PERSONA_ASSET), `omo.js names ${PERSONA_ASSET}=${bundle.includes(PERSONA_ASSET)}`, "persona-not-referenced")

  // ---- the sidecar entry --------------------------------------------------------------------------------------
  for (const [name, literal] of Object.entries(SIDECAR_ENTRY_MARKERS)) {
    record(`sidecar.${name}`, bundle.includes(literal), `omo.js contains ${JSON.stringify(literal)}=${bundle.includes(literal)}`, `sidecar-marker-missing:${name}`)
  }

  // ---- the five read-only tool closures, no aliases -------------------------------------------------------------
  const registryLiteral = JSON.stringify(expectTools)
  record("tools.registry-exact", bundle.includes(registryLiteral), `omo.js contains ${registryLiteral}=${bundle.includes(registryLiteral)}`, "tool-registry-mismatch")
  const closures = {}
  for (const name of expectTools) {
    const literal = TOOL_CLOSURE_MARKERS[name]
    closures[name] = literal === undefined ? false : bundle.includes(literal)
    record(`tools.closure.${name}`, closures[name], literal === undefined ? `no closure marker is known for ${name}` : `omo.js contains ${JSON.stringify(literal)}=${closures[name]}`, `tool-closure-missing:${name}`)
  }
  // Every string-array literal that names the sidecar-only tools is a sidecar registry; each must be
  // exactly the expected list, and no forbidden name may own a Kibitzer-labelled closure.
  const registries = [...bundle.matchAll(/\[(?:"[A-Za-z0-9_-]+",)*"[A-Za-z0-9_-]+"\]/gu)]
    .map((match) => JSON.parse(match[0]))
    .filter((names) => names.includes("session_entries") && names.includes("nudge"))
  const registriesWithAlias = registries.filter((names) => names.some((name) => forbidAliases.includes(name)))
  const aliasClosures = forbidAliases.filter((alias) => bundle.includes(`label:"Kibitzer ${alias}"`))
  record("tools.no-aliases", registries.length > 0 && registriesWithAlias.length === 0 && aliasClosures.length === 0 && registries.every((names) => JSON.stringify(names) === registryLiteral) && forbidAliases.every((alias) => !expectTools.includes(alias)), `sidecarRegistries=${JSON.stringify(registries)} withForbiddenName=${JSON.stringify(registriesWithAlias)} forbiddenClosures=[${aliasClosures.join(",")}]`, "tool-alias-registered")
  const memoryAliasNames = ["memory_read", "memory_search", "memory_write"].filter((alias) => bundle.includes(`"${alias}"`))
  record("tools.no-memory-aliases-as-names", memoryAliasNames.length === 0, `quoted memory alias names in omo.js=[${memoryAliasNames.join(",")}]`, "memory-alias-name-present")

  const failures = checks.filter((check) => !check.ok)
  return {
    ok: failures.length === 0,
    layer: LAYER,
    driver: "kibitzer-sidecar-manifest-check",
    pluginRoot,
    source,
    artifacts,
    persona: { staged: artifacts[PERSONA_ASSET], source: personaSource },
    tools: { expected: expectTools, closures, forbiddenAliases: forbidAliases },
    checks,
    failures: failures.map((check) => check.name),
    reasons,
  }
}

/** A copy of the plugin's shipped surface with the persona asset removed: the RED path of this guard. */
function withoutSidecarAsset(pluginRoot, run) {
  const root = mkdtempSync(join(tmpdir(), "kibitzer-manifest-red-"))
  try {
    mkdirSync(join(root, "extensions"), { recursive: true })
    copyFileSync(join(pluginRoot, "package.json"), join(root, "package.json"))
    for (const name of readdirSync(join(pluginRoot, "extensions"))) {
      if (name === PERSONA_ASSET) continue
      const file = join(pluginRoot, "extensions", name)
      if (statSync(file).isFile()) copyFileSync(file, join(root, "extensions", name))
    }
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  let payload
  if (options.removeSidecarAsset) {
    payload = withoutSidecarAsset(options.pluginRoot, (root) => ({ ...checkManifest({ ...options, pluginRoot: root }), mode: "remove-sidecar-asset", originalPluginRoot: options.pluginRoot }))
  } else {
    payload = checkManifest(options)
  }
  for (const check of payload.checks) console.log(`${check.ok ? "PASS" : "FAIL"} [${check.layer}] ${check.name} :: ${check.detail}`)
  let evidence
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    evidence = join(options.evidenceDir, "manifest.json")
    writeFileSync(evidence, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`evidence: ${evidence}`)
  }
  console.log(JSON.stringify({
    ok: payload.ok,
    layer: LAYER,
    driver: payload.driver,
    ...(payload.mode === undefined ? {} : { mode: payload.mode }),
    pluginRoot: payload.pluginRoot,
    bundleSha256: payload.artifacts["omo.js"].sha256 ?? null,
    personaSha256: payload.persona.staged.sha256 ?? null,
    tools: payload.tools.expected,
    checks: payload.checks.length,
    failures: payload.failures,
    reasons: payload.reasons,
    ...(evidence === undefined ? {} : { evidence }),
  }))
  process.exit(payload.ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
