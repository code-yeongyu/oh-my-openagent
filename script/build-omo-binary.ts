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
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { engineSidecarSources, resolvePackageDir, senpiPackageDir, type SidecarSource } from "./engine-sidecar-sources"
import nativeFixture from "./release-binary-native-fixture.json"
import { senpiWorkerCompileArgs } from "./senpi-worker-compile"
import { parseBuildInfo, type OmoBuildInfo } from "../packages/omo-native/build-info"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const compileEntry = join(repoRoot, "packages", "omo-native", "compile-entry.ts")

/** Directory name that prefixes every embedded asset name. */
export const EMBEDDED_PAYLOAD_ROOT = "omo-runtime"
/** Relative path of the embedded runtime manifest inside the payload root. */
export const RUNTIME_MANIFEST_REL_PATH = "runtime-manifest.json"
/** Hard per-binary size budget (150MB). */
export const MAX_BINARY_BYTES = 150 * 1024 * 1024

export interface NativePrebuild {
  readonly fileStem: "senpi_pty" | "senpi_grep"
  readonly packageName: string
  readonly pin: string
  readonly host: string
}

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
  /** Native addon files upstream promises for this target. */
  readonly nativePrebuilds: readonly NativePrebuild[]
}

const nativeFixtureTargets = z.record(z.string(), z.object({
  available: z.boolean(),
  prebuildHost: z.string().min(1).nullable(),
}))
const nativeFixtureSchema = z.object({
  $comment: z.string(),
  generatedAt: z.string(),
  prebuilds: z.object({
    senpi_pty: z.object({
      packageName: z.literal("@code-yeongyu/senpi-pty"),
      pinSource: z.literal("ptyPin"),
      pin: z.string().min(1),
      targets: nativeFixtureTargets,
    }),
    senpi_grep: z.object({
      packageName: z.literal("@code-yeongyu/senpi"),
      pinSource: z.literal("enginePin"),
      targets: nativeFixtureTargets,
    }),
  }),
})

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

/** Validates the per-package fixture and resolves each available addon's pin. */
export function loadReleaseBinaryTargets(
  input: unknown,
  enginePin = ENGINE_PIN,
): readonly ReleaseBinaryTarget[] {
  const fixture = nativeFixtureSchema.parse(input)
  return TARGET_DEFINITIONS.map(([target, os, bunTarget]) => {
    const nativePrebuilds: NativePrebuild[] = []
    for (const fileStem of ["senpi_pty", "senpi_grep"] as const) {
      const prebuild = fixture.prebuilds[fileStem]
      const entry = prebuild.targets[target]
      if (entry === undefined) {
        throw new Error(`release-binary-native-fixture.json: ${fileStem} is missing target ${target}`)
      }
      if (!entry.available) continue
      if (entry.prebuildHost === null) {
        throw new Error(`release-binary-native-fixture.json: ${fileStem} ${target} is available without a prebuildHost`)
      }
      nativePrebuilds.push({
        fileStem,
        packageName: prebuild.packageName,
        pin: prebuild.pinSource === "enginePin" ? enginePin : prebuild.pin,
        host: entry.prebuildHost,
      })
    }
    return {
      target,
      bunTarget,
      os,
      binaryName: os === "windows" ? `omo-${target}.exe` : `omo-${target}`,
      enginePin,
      nativePrebuilds,
    }
  })
}

export const RELEASE_BINARY_TARGETS = loadReleaseBinaryTargets(nativeFixture)

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
export function createStampedPackageJson(omoAiVersion: string, buildInfo?: OmoBuildInfo): string {
  const stamped = buildInfo === undefined
    ? { name: "omo", version: omoAiVersion }
    : { name: "omo", version: omoAiVersion, omoBuild: buildInfo }
  return `${JSON.stringify(stamped, null, 2)}\n`
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
  readonly buildInfo?: OmoBuildInfo
  readonly entries: readonly RuntimeManifestEntry[]
}

function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/** Builds the embedded runtime manifest for a staged payload directory. */
export async function buildRuntimeManifest(
  stageDir: string,
  options: { readonly omoAiVersion: string; readonly enginePin: string; readonly buildInfo?: OmoBuildInfo },
): Promise<RuntimeManifest> {
  const entries: RuntimeManifestEntry[] = collectStagedFiles(stageDir)
    .filter((relPath) => relPath !== RUNTIME_MANIFEST_REL_PATH)
    .map((relPath) => {
      const absolutePath = join(stageDir, ...relPath.split("/"))
      const stats = statSync(absolutePath)
      return {
        relPath,
        sha256: sha256OfFile(absolutePath),
        // Native addons must extract executable even from non-executable source
        // archives or build hosts that do not expose POSIX permission bits.
        mode: relPath.startsWith("native/prebuilds/") ? 0o755 : stats.mode & 0o777,
        size: stats.size,
      }
    })
  const digestPayload = options.buildInfo === undefined
    ? { omoAiVersion: options.omoAiVersion, enginePin: options.enginePin, entries }
    : { omoAiVersion: options.omoAiVersion, enginePin: options.enginePin, buildInfo: options.buildInfo, entries }
  const manifestSha = createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex")
  if (options.buildInfo === undefined) {
    return { omoAiVersion: options.omoAiVersion, enginePin: options.enginePin, manifestSha, entries }
  }
  return { omoAiVersion: options.omoAiVersion, enginePin: options.enginePin, manifestSha, buildInfo: options.buildInfo, entries }
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

// Mirrors PAYLOAD_DIRECTORIES / PAYLOAD_FILES in script/build-omo-native.ts (locked by build-omo-binary.test.ts).
export const PLUGIN_PAYLOAD_DIRECTORIES = ["extensions", "skills", "skills-conditional", "runtime"] as const
export const PLUGIN_PAYLOAD_FILES = ["package.json", "CHANGELOG.md", "README.md", "NOTICE", "LICENSE"] as const

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
 * engine sidecars UNION plugin payload UNION native prebuilds UNION stamped package.json.
 * Native files come from the fixture, even when they must be fetched at staging time.
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
  for (const entry of target.nativePrebuilds) {
    relPaths.add(nativePrebuildRelPath(entry))
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

function nativePrebuildRelPath(entry: NativePrebuild): string {
  return `native/prebuilds/${entry.host}/${entry.fileStem}.${entry.host}.node`
}

function resolveNativePackageDir(packageName: string): string | undefined {
  if (packageName === "@code-yeongyu/senpi") return senpiPackageDir
  const packageDir = resolvePackageDir(packageName)
  // The installed engine currently declares senpi-pty through this npm alias.
  return packageDir ?? (packageName === "@code-yeongyu/senpi-pty"
    ? resolvePackageDir("@earendil-works/pi-pty")
    : undefined)
}

/** Stages exactly the promised addon, preferring the installed package over npm. */
export function stageNativePrebuild(
  entry: NativePrebuild,
  stageDir: string,
  staged: Set<string>,
  dependencies: {
    readonly resolvePackageDir?: (packageName: string) => string | undefined
    readonly runCommand?: typeof runCommand
  } = {},
): void {
  const payloadRelPath = nativePrebuildRelPath(entry)
  const localPackageDir = (dependencies.resolvePackageDir ?? resolveNativePackageDir)(entry.packageName)
  const localPrebuild = localPackageDir === undefined ? undefined : join(localPackageDir, payloadRelPath)
  if (localPrebuild !== undefined && existsSync(localPrebuild) && statSync(localPrebuild).isFile()) {
    stageSource({ from: localPrebuild, to: payloadRelPath, required: true }, stageDir, staged)
    return
  }
  const execute = dependencies.runCommand ?? runCommand
  const packageSpec = `${entry.packageName}@${entry.pin}`
  const packRoot = mkdtempSync(join(tmpdir(), "omo-native-pack-"))
  try {
    execute("npm", ["pack", packageSpec], packRoot)
    const tarball = readdirSync(packRoot).find((name) => name.endsWith(".tgz"))
    if (tarball === undefined) throw new Error(`npm pack produced no tarball for ${packageSpec}`)
    execute("tar", ["xzf", tarball], packRoot)
    const extracted = join(packRoot, "package", payloadRelPath)
    if (!existsSync(extracted) || !statSync(extracted).isFile()) {
      throw new Error(
        `missing required sidecar source: ${payloadRelPath}; ${packageSpec} ships no such file, but release-binary-native-fixture.json marks ${entry.fileStem} as available`,
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
  buildInfo?: OmoBuildInfo,
): string[] {
  mkdirSync(stageDir, { recursive: true })
  const staged = new Set<string>()
  writeFileSync(join(stageDir, "package.json"), createStampedPackageJson(omoAiVersion, buildInfo), "utf8")
  staged.add("package.json")
  for (const source of engineSidecarSources()) stageSource(source, stageDir, staged)
  stagePluginPayload(stageDir, staged)
  for (const entry of target.nativePrebuilds) stageNativePrebuild(entry, stageDir, staged)
  return [...staged].sort()
}

export interface BuildReleaseBinaryOptions {
  readonly omoVersion: string
  readonly omoAiVersion: string
  readonly outDir?: string
  readonly buildInfo?: OmoBuildInfo
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
    stageSidecarPayload(target, stageDir, options.omoAiVersion, options.buildInfo)

    const manifest = await buildRuntimeManifest(stageDir, {
      omoAiVersion: options.omoAiVersion,
      enginePin: target.enginePin,
      buildInfo: options.buildInfo,
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
          "--minify-whitespace",
          "--compile-autoload-package-json",
          "--no-compile-autoload-dotenv",
          "--no-compile-autoload-bunfig",
          `--asset=${stageDir}`,
          compileEntry,
          ...senpiWorkerCompileArgs(repoRoot),
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
  readonly buildInfo: OmoBuildInfo | undefined
}

function parseBuildInfoValue(raw: string): OmoBuildInfo {
  const parsed = parseBuildInfo(JSON.parse(raw))
  if (parsed === undefined) throw new Error("--build-info is not a valid OmoBuildInfo payload")
  return parsed
}

function parseArgs(argv: readonly string[]): CliOptions {
  let targetName: string | undefined
  let omoVersion: string | undefined
  let omoAiVersion: string | undefined
  let outDir: string | undefined
  let buildInfo: OmoBuildInfo | undefined
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
    } else if (argument === "--build-info") {
      if (value === undefined) throw new Error("--build-info requires a value")
      buildInfo = parseBuildInfoValue(value)
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
  return { targets, omoVersion, omoAiVersion, outDir, buildInfo }
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  for (const target of options.targets) {
    const result = await buildReleaseBinary(target, {
      omoVersion: options.omoVersion,
      omoAiVersion: options.omoAiVersion,
      outDir: options.outDir,
      buildInfo: options.buildInfo,
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
