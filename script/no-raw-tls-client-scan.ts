import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { findRawTlsClients } from "./no-raw-tls-client"
import type { AllowlistEntry, ScanItem, ScanVerdict } from "./no-raw-tls-client"

export { findRawTlsClients, normalizeCallText } from "./no-raw-tls-client"
export type { AllowlistEntry, RawTlsHit, ScanItem, ScanVerdict } from "./no-raw-tls-client"

function repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("repo root sentinel not found")
    }
    dir = parent
  }
}

export const WORKSPACE_ROOT = repoRootFrom(import.meta.dir)

export function evaluateShippedSource(scan: ScanItem[], allowlist: AllowlistEntry[]): ScanVerdict {
  const offenders: string[] = []
  const matched = new Map<AllowlistEntry, number>(allowlist.map((entry) => [entry, 0] as const))
  const scannedPaths = new Set(scan.map((item) => item.path))
  for (const item of scan) {
    for (const hit of findRawTlsClients(item.content, item.path)) {
      const entry = allowlist.find((candidate) => candidate.file === item.path && candidate.call === hit.text)
      if (entry) {
        matched.set(entry, (matched.get(entry) ?? 0) + 1)
        continue
      }
      offenders.push(item.path + ":" + hit.line + "  " + hit.text)
    }
  }
  const stale: string[] = []
  for (const entry of allowlist) {
    const seen = matched.get(entry) ?? 0
    if (!scannedPaths.has(entry.file)) {
      stale.push(entry.file + ": stale allowlist entry (no longer scanned)")
    } else if (seen !== entry.count) {
      stale.push(entry.file + ": expected " + entry.call + " x" + entry.count + ", found x" + seen)
    }
    if (!entry.reason?.trim()) {
      stale.push(entry.file + ": allowlist entry without a reason")
    }
  }
  return { offenders, stale }
}

export function listTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: WORKSPACE_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
}

// Only ENOENT is tolerated (review D4): a vanished tracked file is a race,
// anything else (permissions, EISDIR) must fail loudly, not shrink scope.
export function readSourceFile(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"])
const EXCLUDED_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "__fixtures__",
  "test-support",
  "test-fixtures",
  "references",
  "docs",
  "node_modules",
])

export function isScannedSourceFile(relativePath: string): boolean {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1)
  if (/\.(test|spec)\.[a-z]+$/.test(name)) return false
  if (name.endsWith(".d.ts")) return false
  if (!SOURCE_EXTENSIONS.has(path.extname(name))) return false
  const segments = relativePath.split("/")
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false
  return true
}

// Build-generated (gitignored) runtimes that ship inside the plugin
// payloads. omowright is our own repo (lead decision B, 2026-10-10): its
// built runtime stays IN scope. The tls.connect there is the bundled
// ws@8.21.3 WebSocket client, whose host and servername come from
// new URL(address).hostname (verified on Bun 1.4.2, omowright#40; the
// omowright repo now has its own guard, omowright#41). git ls-files never
// lists these files - they exist only after a build - so this explicit
// probe is how the guard reaches them: scanned and pinned when present,
// entries skipped when no build ran (nothing exists to guard). The list
// is also the complete manifest of what stage-omowright-runtime.mjs
// stages per plugin tree (STAGED_FILES: index.js + page-bundle.js):
// evaluateBuiltRuntimeProbe fails CI on a missing entry and on any
// staged runtime file the list does not name, so a staging-path change
// cannot silently shrink the guard's scope.
export const KNOWN_BUILT_RUNTIMES = [
  "packages/omo-codex/plugin/skills/browser/runtime/omowright/index.js",
  "packages/omo-codex/plugin/skills/browser/runtime/omowright/page-bundle.js",
  "packages/omo-senpi/plugin/skills/browser/runtime/omowright/index.js",
  "packages/omo-senpi/plugin/skills/browser/runtime/omowright/page-bundle.js",
]

// Truly third-party npm-dependency bundles would be named here, one
// comment per bundle. None are tracked today: git ls-files already keeps
// untracked node_modules out of the scan (review O1).
export const THIRD_PARTY_EXCLUDED_BUNDLES: string[] = []

export function isKnownBuiltRuntime(relativePath: string): boolean {
  return KNOWN_BUILT_RUNTIMES.includes(relativePath)
}

export type BuiltRuntimeProbeVerdict = { scanned: string[]; failures: string[] }

// CI contract for the gitignored built runtimes (review B4): locally an
// absent runtime just means no build ran, but CI always builds before
// running tests, so an absent KNOWN_BUILT_RUNTIMES file means the staging
// path drifted and the guard silently lost coverage. When CI is set,
// every known runtime must exist, and every scannable file discovered
// under a plugin skills runtime/omowright/ directory must be listed.
export function evaluateBuiltRuntimeProbe(input: {
  known: readonly string[]
  present: (relativePath: string) => boolean
  discovered: readonly string[]
  ci: string | undefined
}): BuiltRuntimeProbeVerdict {
  const scanned: string[] = []
  const failures: string[] = []
  for (const runtime of input.known) {
    if (input.present(runtime)) {
      scanned.push(runtime)
      continue
    }
    if (input.ci !== undefined) {
      failures.push(
        "CI: expected built runtime to exist: " +
          runtime +
          " (KNOWN_BUILT_RUNTIMES). The omowright staging path may have moved; update KNOWN_BUILT_RUNTIMES so the guard still scans it.",
      )
    }
  }
  if (input.ci !== undefined) {
    for (const found of input.discovered) {
      if (!input.known.includes(found)) {
        failures.push("CI: built omowright runtime missing from KNOWN_BUILT_RUNTIMES: " + found + ". Add it so the guard scans it.")
      }
    }
  }
  return { scanned, failures }
}

// Every scannable file under a packages/*/plugin/skills/**/runtime/
// omowright/ directory - gitignored build output that only a tree walk
// reaches (git ls-files never lists it). Symlinked directories are
// followed so a symlinked skills sync cannot hide staged files.
export function discoverPluginBuiltRuntimes(): string[] {
  const found: string[] = []
  const isDirectory = (
    dir: string,
    entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
  ): boolean => {
    if (entry.isDirectory()) return true
    if (!entry.isSymbolicLink()) return false
    return statSync(path.join(dir, entry.name)).isDirectory()
  }
  const walk = (dir: string, relative: string, inside: boolean): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue
      const rel = relative + "/" + entry.name
      if (isDirectory(dir, entry)) {
        const entersOmowright = entry.name === "omowright" && relative.endsWith("/runtime")
        walk(path.join(dir, entry.name), rel, inside || entersOmowright)
      } else if (inside && isScannedSourceFile(rel)) {
        found.push(rel)
      }
    }
  }
  for (const pkg of readdirSync(path.join(WORKSPACE_ROOT, "packages"), { withFileTypes: true })) {
    if (pkg.name === "node_modules") continue
    if (!isDirectory(path.join(WORKSPACE_ROOT, "packages"), pkg)) continue
    walk(path.join(WORKSPACE_ROOT, "packages", pkg.name, "plugin", "skills"), "packages/" + pkg.name + "/plugin/skills", false)
  }
  return [...new Set(found)].sort()
}

// Scan roots, derived from what actually ships (review O3):
// - the npm payload: root package.json "files" (bin, postinstall.mjs,
//   script/qa, packages/shared-skills, packages/omo-codex plugin+scripts,
//   lsp-core src, component dists, ...);
// - the omo binary payload: packages/omo-native/package.json "files"
//   (bin, plugin) plus its root *.ts compile inputs, which
//   script/build-omo-binary.ts compiles into the omo binary;
// - every package's src/ and plugin/ trees, the inputs of the dist build.
export function shippedRootEntries(): string[] {
  const roots = new Set<string>()
  const readFilesField = (manifest: string, prefix: string) => {
    const parsed = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, manifest), "utf8")) as { files?: string[] }
    for (const entry of parsed.files ?? []) roots.add(prefix + entry)
  }
  readFilesField("package.json", "")
  readFilesField("packages/omo-native/package.json", "packages/omo-native/")
  for (const entry of readdirSync(path.join(WORKSPACE_ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    roots.add("packages/" + entry.name + "/src")
    roots.add("packages/" + entry.name + "/plugin")
  }
  for (const tracked of listTrackedFiles()) {
    if (/^packages\/omo-native\/[^/]+\.(ts|tsx|js|mjs|cjs)$/.test(tracked)) roots.add(tracked)
  }
  return [...roots].sort()
}

function isUnderRoots(relativePath: string, roots: string[]): boolean {
  return roots.some((entry) => relativePath === entry || relativePath.startsWith(entry + "/"))
}

// Tracked files only (review O1): install and build output (node_modules,
// dist, gitignored bundles) never enter the scan, so the verdict cannot
// depend on whether a build ran. The omowright built runtimes are the one
// deliberate exception: they are probed and scanned when present, and in
// CI the probe also fails when a known runtime is missing or a staged
// runtime file is unlisted (review B4).
export function collectShippedSourceFiles(): string[] {
  const roots = shippedRootEntries()
  const files = listTrackedFiles().filter(
    (file) => isScannedSourceFile(file) && !THIRD_PARTY_EXCLUDED_BUNDLES.includes(file) && isUnderRoots(file, roots),
  )
  const probe = evaluateBuiltRuntimeProbe({
    known: KNOWN_BUILT_RUNTIMES,
    present: (runtime) => readSourceFile(path.join(WORKSPACE_ROOT, runtime)) !== null,
    discovered: discoverPluginBuiltRuntimes(),
    ci: process.env.CI,
  })
  if (probe.failures.length > 0) {
    throw new Error(probe.failures.join("\n"))
  }
  for (const runtime of probe.scanned) {
    if (isScannedSourceFile(runtime)) files.push(runtime)
  }
  return [...new Set(files)].sort()
}
