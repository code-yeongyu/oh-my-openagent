#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { npmSpawnOptions } from "./npm-invocation.mjs"
import { spawnSync } from "node:child_process"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const pkgDir = resolve(repoRoot, "packages", "omo-native")

const REQUIRED_ARTIFACTS = [
  "bin/omo.js",
  // bin/omo.js imports it for omo auth, sync, account and remote; it is a generated output (#9903), so a payload
  // packed without the generated build lacks it.
  "bin/lib/service-auth.generated.js",
  "plugin/package.json",
  "plugin/CHANGELOG.md",
  "plugin/extensions/omo.js",
  // The session gateway's SQLite store runs as a worker thread started from this sidecar beside omo.js.
  "plugin/extensions/gateway-store-worker.mjs",
  // Both inline the macOS sign-in store, which finds the keychain helper two levels up (#11262).
  "plugin/extensions/omo-device-account.js",
  "plugin/extensions/omo-feedback.js",
  // Credential-gated skill: not under plugin/skills (never eager-loaded) but the bundled x-search
  // component resolves ../skills-conditional/x-search/SKILL.md, so the payload must ship it.
  "plugin/skills-conditional/x-search/SKILL.md",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/dag/sdk.js",
  "plugin/runtime/agent-toolkit-sdk/sdk.js",
  // Eval cells import the fleet SDK from OMO_BUNSHIN_TS_SDK_ROOT; the installer requires it too.
  "plugin/runtime/bunshin-ts/sdk.js",
  // omo thread and omo daemon adopt import it (bin/lib/thread.js).
  "plugin/runtime/thread-sdk/sdk.js",
  // omo doctor / omo setup classify task-category coverage through it (bin/lib/category-coverage.js).
  "plugin/runtime/category-coverage/index.js",
  // That bundle inlines the computer-use doctor, which reads the prelude assets from beside itself (#9193).
  "plugin/runtime/category-coverage/assets.generated.json",
  // omo daemon resolves its settings (task.host_engine_policy and task.host_idle_exit_ms) through the config
  // loader with it (bin/lib/daemon-config.js).
  "plugin/runtime/task-config/index.js",
]

// The signed keychain helper (#11262) exists only in the release lane, which builds it on macOS
// (publish.yml passes --release); PR CI packs omo-ai on Linux without it. npm pack lists paths
// only, so its execute bit is read from the file system.
const RELEASE_EXECUTABLE_ARTIFACTS = ["bin/darwin/omo-keychain"]
const releaseMode = process.argv.slice(2).includes("--release")
// The release build preflight packs before publish-platform builds the keychain helper, so it requires the generated
// modules below without the helper.
const preflightMode = process.argv.slice(2).includes("--release-preflight")

// Build outputs git does not track (#13192): only a build writes them, so a release that skipped one would publish
// without it. "Every output the plugin needs" is defined once, in plugin-required-outputs.ts: the installer's
// REQUIRED_PLUGIN_ARTIFACTS plus the packed plugin's import-map targets, and every output script/generated-bundles.json
// lists under a directory this package ships, per output (a pattern is never met by any one matching file).
const PLUGIN_SOURCE_ROOT = "packages/omo-senpi/plugin/"
const SHIPPED_ROOTS = [
  ["packages/omo-native/", ""],
  [PLUGIN_SOURCE_ROOT, "plugin/"],
]
const toRepoPath = (packed) =>
  packed.startsWith("plugin/") ? PLUGIN_SOURCE_ROOT + packed.slice(7) : `packages/omo-native/${packed}`
const toPackedPath = (repoPath) => {
  const root = SHIPPED_ROOTS.find(([source]) => repoPath.startsWith(source))
  return root === undefined ? undefined : root[1] + repoPath.slice(root[0].length)
}

// The list lives in TypeScript behind a workspace alias, so this node process reads it through one call of the job's
// pinned bun (setup-bun in every job that runs this gate); a missing bun is an error line, not a stack trace.
const HELPER_NAME = "script/plugin-required-outputs.ts"

function readPluginRequirements() {
  const result = spawnSync(
    "bun",
    [resolve(scriptDir, "plugin-required-outputs.ts"), resolve(pkgDir, "plugin", "package.json")],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
  if (result.error !== undefined)
    throw new Error(`reading REQUIRED_PLUGIN_ARTIFACTS needs bun: ${result.error.message}`)
  // Every failure of the helper ends in ONE line that names it and the cause, never a stack trace or a raw parser error.
  if (result.status !== 0) {
    const lines = (result.stderr ?? "").trim().split("\n")
    const firstLine = lines.find((line) => /^\s*error:/i.test(line))?.trim() ?? lines[0] ?? ""
    throw new Error(`${HELPER_NAME} exited ${result.status}: ${firstLine}`)
  }
  let read
  try {
    read = JSON.parse(result.stdout)
  } catch {
    throw new Error(`${HELPER_NAME} printed output that is not JSON: ${result.stdout.trim().split("\n")[0] ?? ""}`)
  }
  if (read?.manifestError !== undefined) return read
  const strings = (value) => Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
  const entries = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v?.label === "string" && typeof v?.source === "string")
  // A release check with nothing to check, or one whose entries are malformed, must not pass.
  const empty = (value) => Array.isArray(value) && value.length === 0
  if (empty(read?.pluginOutputs) || empty(read?.generated)) {
    throw new Error("the plugin requirement list is empty: refusing to pass a release check with nothing to check")
  }
  if (!strings(read?.pluginOutputs)) {
    throw new Error(`${HELPER_NAME} gave no usable "pluginOutputs": expected a non-empty array of strings`)
  }
  if (!entries(read?.generated)) {
    throw new Error(
      `${HELPER_NAME} gave no usable "generated": expected a non-empty array of { label: string, source: string }`,
    )
  }
  for (const entry of read.generated) {
    try {
      new RegExp(entry.source)
    } catch {
      throw new Error(
        `${HELPER_NAME} gave a "generated" entry whose source is not a regular expression: ${entry.label}`,
      )
    }
  }
  return read
}

function releaseRequirements() {
  const read = readPluginRequirements()
  // An absent manifest is already a missing artifact of REQUIRED_ARTIFACTS; an unparsable one is reported here.
  if (read.manifestError !== undefined) {
    return [{ label: `plugin/package.json (unreadable: ${read.manifestError})`, met: () => false }]
  }
  const pluginOutputs = read.pluginOutputs
  const requirements = pluginOutputs.map((path) => {
    const packed = `plugin/${path}`
    return { label: packed, met: (paths) => paths.includes(packed) }
  })
  for (const { label, source } of read.generated) {
    const regex = new RegExp(source)
    const packedLabel = label.startsWith("a path matching") ? label : toPackedPath(label)
    if (
      packedLabel === undefined ||
      (!label.startsWith("a path matching") && pluginOutputs.includes(packedLabel.slice(7)))
    )
      continue
    if (label.startsWith("a path matching") && !SHIPPED_ROOTS.some(([source]) => regex.source.startsWith(`^${source}`)))
      continue
    requirements.push({ label: packedLabel, met: (paths) => paths.some((path) => regex.test(toRepoPath(path))) })
  }
  return requirements
}

// A bundle that reads `join(dirname(fileURLToPath(import.meta.url)), "<file>")` needs <file> packed
// next to it; minified bundles keep this shape with renamed helpers, so the helper names are not matched.
const SIBLING_ASSET_READ_RE = /import\.meta\.url\s*\)\s*\)\s*,\s*["']([\w.-]+\.[A-Za-z]\w*)["']/g
const BUNDLE_PATH_RE = /\.m?js$/

const MIN_SKILL_COUNT = 18
const SKILL_PATH_RE = /^plugin\/skills\/[^/]+\/SKILL\.md$/

const FORBIDDEN_RULES = [
  { name: "nested node_modules", matches: (path) => path.includes("node_modules/") },
  { name: "source directory", matches: (path) => path.startsWith("src/") },
  { name: "test directory", matches: (path) => path.startsWith("test/") },
  { name: "test file", matches: (path) => path.includes(".test.") },
]

const MAX_UNPACKED_SIZE = 30 * 1024 * 1024

const MAX_REPORTED_OFFENDERS = 50

function packedPaths() {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    ...npmSpawnOptions(),
  })
  const [result] = JSON.parse(raw)
  if (!result) return { paths: [], unpackedSize: 0 }
  return {
    paths: result.files.map((file) => file.path),
    unpackedSize: result.unpackedSize ?? 0,
  }
}

const errors = []
let paths = []
let unpackedSize = 0

try {
  if (!existsSync(pkgDir)) {
    throw new Error(`package directory not found: ${pkgDir}`)
  }
  if (!existsSync(resolve(pkgDir, "package.json"))) {
    throw new Error(`package.json not found in ${pkgDir}`)
  }
  ;({ paths, unpackedSize } = packedPaths())
} catch (err) {
  errors.push(`npm pack failed: ${err.message}`)
}

const pathSet = new Set(paths)

for (const artifact of REQUIRED_ARTIFACTS) {
  if (!pathSet.has(artifact)) {
    errors.push(`missing artifact: ${artifact}`)
  }
}

let requirements = []
if (releaseMode || preflightMode) {
  try {
    requirements = releaseRequirements()
  } catch (error) {
    // No stack trace: name the cause, e.g. bun missing from the job.
    errors.push(error.message)
  }
}
for (const requirement of requirements) {
  if (!requirement.met(paths)) {
    errors.push(`missing artifact: ${requirement.label}`)
  }
}

for (const artifact of releaseMode ? RELEASE_EXECUTABLE_ARTIFACTS : []) {
  if (!pathSet.has(artifact)) {
    errors.push(`missing artifact: ${artifact}`)
  } else if ((statSync(resolve(pkgDir, artifact)).mode & 0o100) === 0) {
    errors.push(`not executable (u+x): ${artifact}`)
  }
}

for (const path of paths.filter((p) => BUNDLE_PATH_RE.test(p))) {
  const source = readFileSync(resolve(pkgDir, path), "utf8")
  for (const asset of new Set(Array.from(source.matchAll(SIBLING_ASSET_READ_RE), (match) => match[1]))) {
    const sibling = posix.join(posix.dirname(path), asset)
    if (!pathSet.has(sibling)) {
      errors.push(`missing sibling asset: ${path} reads ${sibling}, which is not packed`)
    }
  }
}

const skillCount = paths.filter((p) => SKILL_PATH_RE.test(p)).length
if (skillCount < MIN_SKILL_COUNT) {
  errors.push(`missing: expected >= ${MIN_SKILL_COUNT} skill files (plugin/skills/*/SKILL.md), found ${skillCount}`)
}

if (paths.length > 0) {
  const offenders = paths.flatMap((path) => {
    const rule = FORBIDDEN_RULES.find((candidate) => candidate.matches(path))
    return rule ? [`${rule.name}: ${path}`] : []
  })

  if (offenders.length > 0) {
    errors.push(`forbidden paths (${offenders.length} offending path(s)):`)
    for (const line of offenders.slice(0, MAX_REPORTED_OFFENDERS)) {
      errors.push(`  ${line}`)
    }
    if (offenders.length > MAX_REPORTED_OFFENDERS) {
      errors.push(`  ... and ${offenders.length - MAX_REPORTED_OFFENDERS} more`)
    }
  }

  if (unpackedSize >= MAX_UNPACKED_SIZE) {
    errors.push(`unpacked size ${unpackedSize} bytes exceeds limit ${MAX_UNPACKED_SIZE} bytes (30 MB)`)
  }
}

if (errors.length > 0) {
  console.error(`omo-ai payload verification FAILED (${errors.length} issue(s)):`)
  for (const line of errors) {
    console.error(`  ${line}`)
  }
  process.exit(1)
}

console.log(`omo-ai payload verification OK (${paths.length} packed paths, 0 offenders, ${unpackedSize} bytes)`)
