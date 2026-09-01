#!/usr/bin/env bun
// script/build-omo-binary.ts
// Builds the per-target compiled omo release binaries. Each binary is a single
// bare executable whose sidecar parity set is embedded as compile-time assets
// (see EMBEDDED-RUNTIME CONTRACT in .omo/plans/bun-compile-release-binaries.md).

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ptyFixture from "./release-binary-pty-fixture.json"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const senpiPackageDir = join(repoRoot, "node_modules", "@code-yeongyu", "senpi")
const senpiRequire = createRequire(join(senpiPackageDir, "package.json"))
const compileEntry = join(repoRoot, "packages", "omo-native", "compile-entry.ts")

/** Directory name that prefixes every embedded asset name. */
export const EMBEDDED_PAYLOAD_ROOT = "omo-runtime"
/** Relative path of the embedded runtime manifest inside the payload root. */
export const RUNTIME_MANIFEST_REL_PATH = "runtime-manifest.json"
/** Hard per-binary size budget (150MB). */
export const MAX_BINARY_BYTES = 150 * 1024 * 1024

export interface ReleaseBinaryTarget {
  /** Release asset platform slug, e.g. `darwin-arm64`. */
  readonly target: string
  /** `bun build --compile --target=` value. */
  readonly bunTarget: string
  /** Coarse OS family used for the executable suffix. */
  readonly os: "darwin" | "linux" | "windows"
  /** Release asset file name. */
  readonly binaryName: string
  /** Pinned engine version (@code-yeongyu/senpi). */
  readonly enginePin: string
  /** Pinned senpi-pty version. */
  readonly ptyPin: string
  /** `native/prebuilds/<host>` directory when upstream ships a prebuild, else undefined. */
  readonly ptyPrebuildHost: string | undefined
}

interface PtyFixtureEntry {
  readonly ptyAvailable: boolean
  readonly prebuildHost: string | null
}

const PTY_FIXTURE_TARGETS = ptyFixture.targets as Readonly<Record<string, PtyFixtureEntry>>

function readEnginePin(): string {
  // packages/omo-native is the npm channel that ships the engine, so its pin is
  // authoritative for the binary channel too (both stay lockstep).
  const nativePackage = JSON.parse(
    readFileSync(join(repoRoot, "packages", "omo-native", "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> }
  const pin = nativePackage.dependencies?.["@code-yeongyu/senpi"]
  if (pin === undefined) {
    throw new Error("packages/omo-native/package.json does not pin @code-yeongyu/senpi")
  }
  return pin
}

const ENGINE_PIN = readEnginePin()

// Own map - deliberately NOT script/build-binaries.ts:20-33, whose windows-arm64
// entry maps to bun-windows-x64 (emulation). Release binaries ship TRUE arm64.
const TARGET_DEFINITIONS: readonly (readonly [string, ReleaseBinaryTarget["os"], string])[] = [
  ["darwin-arm64", "darwin", "bun-darwin-arm64"],
  ["darwin-x64", "darwin", "bun-darwin-x64"],
  ["darwin-x64-baseline", "darwin", "bun-darwin-x64-baseline"],
  ["linux-x64", "linux", "bun-linux-x64"],
  ["linux-x64-baseline", "linux", "bun-linux-x64-baseline"],
  ["linux-arm64", "linux", "bun-linux-arm64"],
  ["linux-x64-musl", "linux", "bun-linux-x64-musl"],
  ["linux-x64-musl-baseline", "linux", "bun-linux-x64-musl-baseline"],
  ["linux-arm64-musl", "linux", "bun-linux-arm64-musl"],
  ["windows-x64", "windows", "bun-windows-x64"],
  ["windows-x64-baseline", "windows", "bun-windows-x64-baseline"],
  ["windows-arm64", "windows", "bun-windows-arm64"],
]

export const RELEASE_BINARY_TARGETS: readonly ReleaseBinaryTarget[] = TARGET_DEFINITIONS.map(
  ([target, os, bunTarget]) => {
    const fixture = PTY_FIXTURE_TARGETS[target]
    if (fixture === undefined) {
      throw new Error(`release-binary-pty-fixture.json is missing target ${target}`)
    }
    return {
      target,
      bunTarget,
      os,
      binaryName: os === "windows" ? `omo-${target}.exe` : `omo-${target}`,
      enginePin: ENGINE_PIN,
      ptyPin: ptyFixture.ptyPin,
      ptyPrebuildHost: fixture.ptyAvailable ? (fixture.prebuildHost ?? undefined) : undefined,
    }
  },
)

/** Maps a payload-relative path to the name bun assigns the embedded asset. */
export function embeddedNameForRelPath(relPath: string): string {
  return `${EMBEDDED_PAYLOAD_ROOT}/${relPath}`
}

/** Inverse of {@link embeddedNameForRelPath}; undefined for non-payload assets. */
export function relPathForEmbeddedName(embeddedName: string): string | undefined {
  const prefix = `${EMBEDDED_PAYLOAD_ROOT}/`
  if (!embeddedName.startsWith(prefix)) return undefined
  return embeddedName.slice(prefix.length)
}

/** Stamped sibling package.json the engine reads for its version contract. */
export function createStampedPackageJson(omoAiVersion: string): string {
  return `${JSON.stringify({ name: "omo", version: omoAiVersion }, null, 2)}\n`
}

/** Lists every file under `stageDir` as sorted POSIX-relative paths. */
export function collectStagedFiles(stageDir: string): string[] {
  const collected: string[] = []
  const walk = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.isFile()) {
        collected.push(relative(stageDir, entryPath).split(sep).join("/"))
      }
    }
  }
  walk(stageDir)
  return collected.sort()
}

export interface RuntimeManifestEntry {
  readonly relPath: string
  readonly sha256: string
  readonly mode: number
  readonly size: number
}

export interface RuntimeManifest {
  readonly omoAiVersion: string
  readonly enginePin: string
  readonly manifestSha: string
  readonly entries: readonly RuntimeManifestEntry[]
}

function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/** Builds the embedded runtime manifest for a staged payload directory. */
export async function buildRuntimeManifest(
  stageDir: string,
  options: { readonly omoAiVersion: string; readonly enginePin: string },
): Promise<RuntimeManifest> {
  const entries: RuntimeManifestEntry[] = collectStagedFiles(stageDir)
    .filter((relPath) => relPath !== RUNTIME_MANIFEST_REL_PATH)
    .map((relPath) => {
      const absolutePath = join(stageDir, ...relPath.split("/"))
      const stats = statSync(absolutePath)
      return {
        relPath,
        sha256: sha256OfFile(absolutePath),
        mode: stats.mode & 0o777,
        size: stats.size,
      }
    })
  const manifestSha = createHash("sha256")
    .update(
      JSON.stringify({
        omoAiVersion: options.omoAiVersion,
        enginePin: options.enginePin,
        entries,
      }),
    )
    .digest("hex")
  return { omoAiVersion: options.omoAiVersion, enginePin: options.enginePin, manifestSha, entries }
}

/** Fails loud when a compiled binary exceeds the per-binary size budget. */
export function assertBinarySizeBudget(
  target: string,
  binaryPath: string,
  options: { readonly maxBytes?: number } = {},
): void {
  const maxBytes = options.maxBytes ?? MAX_BINARY_BYTES
  const size = statSync(binaryPath).size
  if (size > maxBytes) {
    throw new Error(
      `release binary size budget exceeded for ${target}: ${size} bytes > ${maxBytes} bytes (${binaryPath})`,
    )
  }
}

const EMBEDDED_PROBE_SOURCE = `import { embeddedFiles } from "bun"
const names = []
let manifest = null
for (const file of embeddedFiles) {
  names.push(file.name)
  if (file.name.endsWith("${RUNTIME_MANIFEST_REL_PATH}")) manifest = JSON.parse(await file.text())
}
console.log(JSON.stringify({ names, manifest }))
`

export interface EmbeddedPayloadReport {
  /** Embedded asset names exactly as bun assigned them. */
  readonly names: readonly string[]
  /** Payload-relative paths recovered from the embedded names. */
  readonly relPaths: readonly string[]
  /** The embedded runtime manifest. */
  readonly manifest: RuntimeManifest
}

/**
 * Reports what a staged payload actually embeds, by compiling a host-target
 * probe against the very same `--asset` directory and running it. The probe
 * shares the build's toolchain, so it also catches a bun that silently drops
 * assets (e.g. a stale bun shadowing PATH).
 */
export function reportEmbeddedPayload(stageDir: string): EmbeddedPayloadReport {
  const probeRoot = mkdtempSync(join(tmpdir(), "omo-embed-probe-"))
  try {
    const probeEntry = join(probeRoot, "probe.ts")
    const probeBinary = join(probeRoot, "probe")
    writeFileSync(probeEntry, EMBEDDED_PROBE_SOURCE, "utf8")
    runCommand(
      "bun",
      ["build", "--compile", `--asset=${stageDir}`, probeEntry, "--outfile", probeBinary],
      probeRoot,
    )
    const probed = spawnSync(probeBinary, [], { encoding: "utf8" })
    if (probed.status !== 0) {
      throw new Error(`embedded payload probe failed: ${probed.stderr}`)
    }
    const parsed = JSON.parse(probed.stdout) as {
      names: string[]
      manifest: RuntimeManifest | null
    }
    if (parsed.manifest === null) {
      throw new Error(
        `embedded payload probe found no runtime manifest (${parsed.names.length} files embedded). The bun on PATH likely predates directory --asset support, which is accepted silently and dropped - resolve a bun >= 1.4 and retry.`,
      )
    }
    const relPaths = parsed.names
      .map((name) => relPathForEmbeddedName(name))
      .filter((relPath): relPath is string => relPath !== undefined)
    return { names: parsed.names, relPaths, manifest: parsed.manifest }
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
  }
}

interface SidecarSource {
  /** Absolute source path (file or directory). */
  readonly from: string
  /** Payload-relative destination path. */
  readonly to: string
  /** When true a missing source aborts the build. */
  readonly required: boolean
}

function resolveFromSenpi(specifier: string): string | undefined {
  try {
    return senpiRequire.resolve(specifier)
  } catch {
    return undefined
  }
}

function resolvePackageDir(packageName: string): string | undefined {
  const packageJsonPath = resolveFromSenpi(`${packageName}/package.json`)
  return packageJsonPath === undefined ? undefined : dirname(packageJsonPath)
}

/**
 * Sidecar parity set = senpi's own copy-binary-assets manifest (re-read from
 * node_modules/@code-yeongyu/senpi/package.json scripts.copy-binary-assets)
 * mapped from the published npm layout onto the flattened binary layout the
 * engine resolves next to process.execPath.
 */
function engineSidecarSources(): SidecarSource[] {
  const dist = join(senpiPackageDir, "dist")
  const sources: SidecarSource[] = [
    { from: join(senpiPackageDir, "README.md"), to: "README.md", required: true },
    { from: join(senpiPackageDir, "CHANGELOG.md"), to: "CHANGELOG.md", required: true },
    { from: join(dist, "modes", "interactive", "theme"), to: "theme", required: true },
    { from: join(dist, "modes", "interactive", "assets"), to: "assets", required: true },
    { from: join(dist, "core", "export-html"), to: "export-html", required: true },
    { from: join(senpiPackageDir, "docs"), to: "docs", required: true },
    { from: join(senpiPackageDir, "examples"), to: "examples", required: true },
    { from: join(senpiPackageDir, "vendor"), to: "vendor", required: true },
  ]
  for (const packageName of ["css-tree", "mdn-data", "source-map-js"]) {
    const packageDir = resolvePackageDir(packageName)
    if (packageDir === undefined) {
      throw new Error(`sidecar dependency ${packageName} is not installed under the senpi package`)
    }
    sources.push({ from: packageDir, to: `node_modules/${packageName}`, required: true })
  }
  const codemodeDir = resolvePackageDir("@code-yeongyu/senpi-codemode")
  if (codemodeDir === undefined) {
    throw new Error("codemode sidecar @code-yeongyu/senpi-codemode is not installed")
  }
  sources.push({
    from: codemodeDir,
    to: "node_modules/@code-yeongyu/senpi-codemode",
    required: true,
  })
  const photonDir = resolvePackageDir("@silvia-odwyer/photon-node")
  if (photonDir === undefined) {
    throw new Error("@silvia-odwyer/photon-node is not installed under the senpi package")
  }
  sources.push({
    from: join(photonDir, "photon_rs_bg.wasm"),
    to: "photon_rs_bg.wasm",
    required: true,
  })
  const tuiDir = resolvePackageDir("@earendil-works/pi-tui")
  if (tuiDir !== undefined) {
    for (const platform of ["darwin", "win32"]) {
      const prebuilds = join(tuiDir, "native", platform, "prebuilds")
      if (existsSync(prebuilds)) {
        sources.push({ from: prebuilds, to: `native/${platform}/prebuilds`, required: false })
      }
    }
  }
  return sources
}

// Mirrors PAYLOAD_DIRECTORIES / PAYLOAD_FILES in script/build-omo-native.ts.
const PLUGIN_PAYLOAD_DIRECTORIES = ["extensions", "skills", "runtime"] as const
const PLUGIN_PAYLOAD_FILES = ["package.json", "README.md", "NOTICE", "LICENSE"] as const

const EXPORT_HTML_KEEP = new Set([
  "template.html",
  "template.css",
  "template.js",
  "vendor/marked.min.js",
  "vendor/highlight.min.js",
])

function shouldStageFile(relPath: string): boolean {
  if (relPath.endsWith(".map")) return false
  if (relPath.startsWith("theme/")) return relPath.endsWith(".json")
  if (relPath.startsWith("assets/")) return relPath.endsWith(".png")
  if (relPath.startsWith("export-html/")) {
    return EXPORT_HTML_KEEP.has(relPath.slice("export-html/".length))
  }
  return true
}

function copyTree(from: string, to: string, payloadRelPath: string, staged: Set<string>): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const sourcePath = join(from, entry.name)
    const targetPath = join(to, entry.name)
    const relPath = `${payloadRelPath}/${entry.name}`
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, relPath, staged)
    } else if (entry.isFile()) {
      if (!shouldStageFile(relPath)) continue
      mkdirSync(dirname(targetPath), { recursive: true })
      copyFileSync(sourcePath, targetPath)
      chmodSync(targetPath, statSync(sourcePath).mode & 0o777)
      staged.add(relPath)
    }
  }
}

function stageSource(source: SidecarSource, stageDir: string, staged: Set<string>): void {
  if (!existsSync(source.from)) {
    if (source.required) {
      throw new Error(`missing required sidecar source: ${source.from}`)
    }
    return
  }
  const targetPath = join(stageDir, ...source.to.split("/"))
  if (statSync(source.from).isDirectory()) {
    mkdirSync(targetPath, { recursive: true })
    copyTree(source.from, targetPath, source.to, staged)
    return
  }
  if (!shouldStageFile(source.to)) return
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(source.from, targetPath)
  chmodSync(targetPath, statSync(source.from).mode & 0o777)
  staged.add(source.to)
}

/**
 * The payload-relative paths the built binary for `target` must embed:
 * engine sidecars UNION plugin payload UNION pty prebuild UNION stamped package.json.
 * Resolved from the installed sources, so it doubles as the parity expectation.
 */
export function resolveExpectedSidecarRelPaths(target: ReleaseBinaryTarget): string[] {
  const relPaths = new Set<string>(["package.json"])
  const collectFrom = (from: string, to: string): void => {
    if (!existsSync(from)) return
    if (!statSync(from).isDirectory()) {
      if (shouldStageFile(to)) relPaths.add(to)
      return
    }
    for (const relPath of collectStagedFiles(from)) {
      const payloadRelPath = `${to}/${relPath}`
      if (shouldStageFile(payloadRelPath)) relPaths.add(payloadRelPath)
    }
  }
  for (const source of engineSidecarSources()) collectFrom(source.from, source.to)
  // The staged plugin is build-omo-native's payload allowlist, not the whole
  // source plugin dir (mirrors PAYLOAD_* in script/build-omo-native.ts).
  const pluginDir = join(repoRoot, "packages", "omo-senpi", "plugin")
  for (const name of PLUGIN_PAYLOAD_DIRECTORIES) {
    collectFrom(join(pluginDir, name), `plugin/${name}`)
  }
  for (const name of PLUGIN_PAYLOAD_FILES) {
    collectFrom(join(pluginDir, name), `plugin/${name}`)
  }
  collectFrom(join(pluginDir, "scripts", "install.mjs"), "plugin/scripts/install.mjs")
  if (target.ptyPrebuildHost !== undefined) {
    const ptyDir = resolvePackageDir("@earendil-works/pi-pty")
    if (ptyDir !== undefined) {
      collectFrom(
        join(ptyDir, "native", "prebuilds", target.ptyPrebuildHost),
        `native/prebuilds/${target.ptyPrebuildHost}`,
      )
    }
  }
  return [...relPaths].sort()
}

function runCommand(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], { cwd, stdio: "inherit" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`)
  }
}

function runCommandCaptured(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}:\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result.stdout
}

/**
 * bun reports the bundled module count as `bundle <n> modules`. The engine
 * graph is ~4000 modules; an entry whose senpi import lost static traceability
 * (const indirection, runtime-resolved URL) bundles ~7. If the line cannot be
 * parsed at all the build fails rather than guessing - a bun output format
 * change must be a loud failure, not a silently engine-less binary.
 */
export function parseBundledModuleCount(bunBuildOutput: string): number | undefined {
  const match = /bundle\s+(\d+)\s+modules/.exec(bunBuildOutput)
  return match === null ? undefined : Number.parseInt(match[1]!, 10)
}

/** Floor far below the ~4000-module engine graph, far above the ~7-module launcher-only graph. */
export const ENGINE_MINIMUM_MODULES = 1000

export function assertEngineGraphBundled(bunBuildOutput: string): number {
  const modules = parseBundledModuleCount(bunBuildOutput)
  if (modules === undefined) {
    throw new Error(
      `could not read the bundled module count from bun's output - refusing to ship a binary whose engine graph may be missing:\n${bunBuildOutput}`,
    )
  }
  if (modules < ENGINE_MINIMUM_MODULES) {
    throw new Error(
      `only ${modules} modules were bundled (expected >= ${ENGINE_MINIMUM_MODULES}): the senpi engine graph is missing from the binary. The compile entry's engine import must stay an inline string literal - bun does not trace import() through consts or runtime-resolved URLs.`,
    )
  }
  return modules
}

function stagePluginPayload(stageDir: string, staged: Set<string>): void {
  const pluginStageRoot = mkdtempSync(join(tmpdir(), "omo-plugin-stage-"))
  try {
    const pluginStage = join(pluginStageRoot, "plugin")
    runCommand("bun", ["run", "script/build-omo-native.ts", "--output", pluginStage], repoRoot)
    stageSource({ from: pluginStage, to: "plugin", required: true }, stageDir, staged)
  } finally {
    rmSync(pluginStageRoot, { recursive: true, force: true })
  }
}

function stagePtyPrebuild(
  target: ReleaseBinaryTarget,
  stageDir: string,
  staged: Set<string>,
): void {
  if (target.ptyPrebuildHost === undefined) return
  const host = target.ptyPrebuildHost
  const payloadRelPath = `native/prebuilds/${host}`
  const localPtyDir = resolvePackageDir("@earendil-works/pi-pty")
  const localPrebuild =
    localPtyDir === undefined ? undefined : join(localPtyDir, "native", "prebuilds", host)
  if (localPrebuild !== undefined && existsSync(localPrebuild)) {
    stageSource({ from: localPrebuild, to: payloadRelPath, required: true }, stageDir, staged)
    return
  }
  const packRoot = mkdtempSync(join(tmpdir(), "omo-pty-pack-"))
  try {
    runCommand("npm", ["pack", `@code-yeongyu/senpi-pty@${target.ptyPin}`], packRoot)
    const tarball = readdirSync(packRoot).find((name) => name.endsWith(".tgz"))
    if (tarball === undefined) throw new Error("npm pack produced no senpi-pty tarball")
    runCommand("tar", ["xzf", tarball], packRoot)
    const extracted = join(packRoot, "package", "native", "prebuilds", host)
    if (!existsSync(extracted)) {
      throw new Error(
        `senpi-pty@${target.ptyPin} ships no prebuild for ${host}, but release-binary-pty-fixture.json marks ${target.target} as pty-available`,
      )
    }
    stageSource({ from: extracted, to: payloadRelPath, required: true }, stageDir, staged)
  } finally {
    rmSync(packRoot, { recursive: true, force: true })
  }
}

/**
 * Stages the full sidecar parity set for `target` into `stageDir` and returns
 * the staged payload-relative paths.
 */
export function stageSidecarPayload(
  target: ReleaseBinaryTarget,
  stageDir: string,
  omoAiVersion: string,
): string[] {
  mkdirSync(stageDir, { recursive: true })
  const staged = new Set<string>()
  writeFileSync(join(stageDir, "package.json"), createStampedPackageJson(omoAiVersion), "utf8")
  staged.add("package.json")
  for (const source of engineSidecarSources()) stageSource(source, stageDir, staged)
  stagePluginPayload(stageDir, staged)
  stagePtyPrebuild(target, stageDir, staged)
  return [...staged].sort()
}

export interface BuildReleaseBinaryOptions {
  readonly omoVersion: string
  readonly omoAiVersion: string
  readonly outDir?: string
}

export interface BuildReleaseBinaryResult {
  readonly target: string
  readonly binaryPath: string
  readonly sha256: string
  readonly size: number
  readonly manifest: RuntimeManifest
}

/** Builds one bare release binary with its sidecar parity set embedded. */
export async function buildReleaseBinary(
  target: ReleaseBinaryTarget,
  options: BuildReleaseBinaryOptions,
): Promise<BuildReleaseBinaryResult> {
  if (!existsSync(compileEntry)) {
    throw new Error(`compile entry is missing: ${compileEntry}`)
  }
  const outDir = options.outDir ?? join(repoRoot, ".omo", "release-binaries")
  const workRoot = mkdtempSync(join(tmpdir(), `omo-binary-${target.target}-`))
  try {
    const stagedRoot = join(workRoot, EMBEDDED_PAYLOAD_ROOT)
    mkdirSync(stagedRoot, { recursive: true })
    // Canonicalize the staging directory before it reaches bun: TMPDIR is a
    // symlinked path on macOS (/var/folders -> /private/var/folders) and the
    // handoff between the bundler and the compile step must agree on one
    // spelling. Basename is preserved, so embedded names stay
    // `${EMBEDDED_PAYLOAD_ROOT}/<relPath>`.
    const stageDir = realpathSync(stagedRoot)
    stageSidecarPayload(target, stageDir, options.omoAiVersion)

    const manifest = await buildRuntimeManifest(stageDir, {
      omoAiVersion: options.omoAiVersion,
      enginePin: target.enginePin,
    })
    writeFileSync(
      join(stageDir, RUNTIME_MANIFEST_REL_PATH),
      `${JSON.stringify({ marker: "OMO_RUNTIME_MANIFEST_V1", ...manifest })}\n`,
      "utf8",
    )

    mkdirSync(outDir, { recursive: true })
    const binaryPath = join(outDir, target.binaryName)

    // Probe BEFORE the expensive target compile: a bun that predates the
    // directory `--asset` flag (e.g. 1.3.14) ignores it silently and exits 0,
    // which would otherwise ship an asset-less binary. The probe runs the same
    // toolchain against the same stage, so it fails loud within seconds
    // instead of after a full cross-compile.
    const embedded = reportEmbeddedPayload(stageDir)
    const expected = collectStagedFiles(stageDir)
    const missing = expected.filter((relPath) => !embedded.relPaths.includes(relPath))
    if (missing.length > 0) {
      throw new Error(
        `embedded payload is incomplete for ${target.target}: ${missing.length} of ${expected.length} sidecar files were not embedded (first missing: ${missing[0]}). The bun on PATH likely predates directory --asset support - resolve a bun >= 1.4 and retry.`,
      )
    }

    // Flags mirror senpi's own scripts.build:binary (node_modules/@code-yeongyu/senpi/package.json).
    // A binary that fails post-compile verification must not survive on disk.
    let compileOutput: string
    try {
      compileOutput = runCommandCaptured(
        "bun",
        [
          "build",
          "--compile",
          `--target=${target.bunTarget}`,
          "--compile-autoload-package-json",
          "--no-compile-autoload-dotenv",
          "--no-compile-autoload-bunfig",
          `--asset=${stageDir}`,
          compileEntry,
          "--outfile",
          binaryPath,
        ],
        repoRoot,
      )
      assertEngineGraphBundled(compileOutput)
      assertBinarySizeBudget(target.target, binaryPath)
    } catch (error) {
      rmSync(binaryPath, { force: true })
      throw error
    }

    const size = statSync(binaryPath).size
    const sha256 = sha256OfFile(binaryPath)
    appendFileSync(join(outDir, "SHA256SUMS"), `${sha256}  ${target.binaryName}\n`, "utf8")
    return { target: target.target, binaryPath, sha256, size, manifest }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

interface CliOptions {
  readonly targets: readonly ReleaseBinaryTarget[]
  readonly omoVersion: string
  readonly omoAiVersion: string
  readonly outDir: string | undefined
}

function parseArgs(argv: readonly string[]): CliOptions {
  let targetName: string | undefined
  let omoVersion: string | undefined
  let omoAiVersion: string | undefined
  let outDir: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (argument === "--target") {
      if (value === undefined) throw new Error("--target requires a value")
      targetName = value
      index += 1
    } else if (argument === "--omo-version") {
      if (value === undefined) throw new Error("--omo-version requires a value")
      omoVersion = value
      index += 1
    } else if (argument === "--omo-ai-version") {
      if (value === undefined) throw new Error("--omo-ai-version requires a value")
      omoAiVersion = value
      index += 1
    } else if (argument === "--out-dir") {
      if (value === undefined) throw new Error("--out-dir requires a value")
      outDir = resolve(value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  if (omoVersion === undefined) throw new Error("--omo-version is required")
  if (omoAiVersion === undefined) throw new Error("--omo-ai-version is required")
  const targets =
    targetName === undefined
      ? RELEASE_BINARY_TARGETS
      : RELEASE_BINARY_TARGETS.filter((entry) => entry.target === targetName)
  if (targets.length === 0) throw new Error(`unknown target: ${targetName}`)
  return { targets, omoVersion, omoAiVersion, outDir }
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  for (const target of options.targets) {
    const result = await buildReleaseBinary(target, {
      omoVersion: options.omoVersion,
      omoAiVersion: options.omoAiVersion,
      outDir: options.outDir,
    })
    console.log(
      `built ${result.target}: ${result.binaryPath} (${result.size} bytes, ${result.manifest.entries.length} embedded sidecar files)`,
    )
  }
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
