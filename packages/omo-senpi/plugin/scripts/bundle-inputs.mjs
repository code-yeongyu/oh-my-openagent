#!/usr/bin/env node
// Writes packages/omo-senpi/bundle-inputs.json: every repo file the generators of the committed bundles read.
// The list is TRACED from the recipe, never hand-kept: the three generator checks below run under
// bundle-inputs-trace.mjs, which records each file read, directory listed, module loaded and bundler input.
// The merge gate reads the map at the base tip to tell whether a PR can change a generated artifact;
// `--check` (CI) re-traces and fails when the committed map differs. A `directories` entry is recursive: any file
// added anywhere below it is an input. Run only explicitly: `bun run bundle-inputs` (write) and `bun run bundle-inputs:check`
// (CI). Never part of build:senpi-plugin:stage, `build`, `prepare` or a test chain: `bun install` runs `prepare`, and the trace
// there hung every Windows install for the whole job timeout. Under an install lifecycle it refuses before any recipe step.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import nodePath, { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, "..", "..", "..", "..")
const tracer = join(scriptDir, "bundle-inputs-trace.mjs")

export const BUNDLE_INPUTS_PATH = "packages/omo-senpi/bundle-inputs.json"

// The generators of the committed artifacts (GENERATED_BUNDLES): the omo-senpi extensions, runtimes and
// staged assets, the omo-senpi installer, and the Codex installer. Each runs in its non-writing form.
// `bundles: true` marks a step that runs the bundler: it must record at least one `bundle` row (checkStepRows),
// so a bundler call the trace failed to recognise fails the trace instead of dropping its source list.
// The staged LSP daemon and ast-grep runtimes (plugin/runtime/lsp-daemon, plugin/runtime/ast-grep-mcp) and the staged x-search
// skill (plugin/skills-conditional) are gitignored output, so they are not inputs of anything committed; their --check steps are
// pointed at a missing local copy (OMO_LSP_DAEMON_DIST, OMO_AST_GREP_MCP_ENTRY, OMO_X_SEARCH_SKILL_TARGET) so every host traces
// the same reads, staged locally or not.
export const RECIPE = [
  { name: "build-extension --check", bundles: true, command: "node", args: ["packages/omo-senpi/plugin/scripts/build-extension.mjs", "--check"] },
  { name: "build-install --check", bundles: true, command: "node", args: ["packages/omo-senpi/plugin/scripts/build-install.mjs", "--check"] },
  {
    name: "build:codex-install (scratch output)",
    bundles: true,
    command: "bun",
    args: ["--preload", tracer, "-e", "const m = await import(process.env.OMO_BUNDLE_INPUTS_CODEX_SCRIPT); await m.buildCodexInstaller({ outputPath: process.env.OMO_BUNDLE_INPUTS_TMP + '/codex/install-local.mjs' })"],
  },
]

// Output-steering knobs the recipe scripts read. A developer shell (or a caller like build:omo-native, whose
// build:senpi-plugin:native chain does not run this script) may set OMO_SENPI_PLUGIN_OUTPUT: inherited, it points the --check steps at a staged copy outside the repo, whose reads drop
// out of the map. The trace always checks the in-repo outputs, so these never reach the recipe.
export const SCRUBBED_ENV = [
  "OMO_SENPI_PLUGIN_OUTPUT",
  "OMO_LSP_DAEMON_TARGET",
  "OMO_AST_GREP_MCP_TARGET",
  "OMO_AGENT_TOOLKIT_SOURCE_ENTRY",
  "OMO_AGENT_TOOLKIT_TARGET",
  "OMO_SENPI_STAGE_FAIL_AFTER_BACKUP",
]

/** The environment every recipe step runs in: the caller's, minus SCRUBBED_ENV, plus the trace wiring. */
export function recipeEnv(scratch, base = process.env) {
  const env = { ...base }
  for (const key of SCRUBBED_ENV) delete env[key]
  return {
    ...env,
    OMO_BUNDLE_INPUTS_TRACE: join(scratch, "trace.jsonl"),
    OMO_BUNDLE_INPUTS_TMP: scratch,
    OMO_BUNDLE_INPUTS_CODEX_SCRIPT: pathToFileURL(join(repoRoot, "script", "build-codex-install.ts")).href,
    OMO_LSP_DAEMON_DIST: join(scratch, "no-local-build", "lsp-daemon-dist"),
    OMO_AST_GREP_MCP_ENTRY: join(scratch, "no-local-build", "ast-grep-cli.js"),
    OMO_X_SEARCH_SKILL_TARGET: join(scratch, "no-local-build", "x-search", "SKILL.md"),
    NODE_OPTIONS: `${base.NODE_OPTIONS ?? ""} --import=${pathToFileURL(tracer).href}`.trim(),
  }
}

/** One step's trace rows, plus a `missing-bundle-rows` row when a bundling step recorded no bundle input. */
export function checkStepRows(step, rows) {
  if (step.bundles !== true || rows.some((row) => row.kind === "bundle")) return rows
  return [...rows, { kind: "missing-bundle-rows", path: step.name }]
}

const RESOLUTION_FILES = ["package.json", "tsconfig.json", "bunfig.toml"]

/**
 * Pure: trace rows -> map. A file under node_modules is pinned by the lockfile, so it becomes bun.lock.
 * Every package.json, tsconfig.json and bunfig.toml between an input and the repo root steers resolution,
 * so those are inputs too. Paths outside the repo (scratch output, the toolchain, another drive) and .git are dropped.
 * Map entries are portable ("/"); `exists` gets platform paths built with `path` (injectable to exercise win32 anywhere).
 */
export function mapFromTrace(rows, { repoRoot: root, exists = existsSync, realpath = realpathSync.native, path: platform = nodePath }) {
  const portable = (path) => path.split(platform.sep).join("/")
  const absRoot = realpath(root)
  const files = new Set()
  const directories = new Set()
  const inRepo = (path) => {
    let real = path
    try { real = realpath(path) } catch { /* a scratch file may be gone already */ }
    const relative = platform.relative(absRoot, real)
    // On win32 a path on another drive has no relative form: relative() returns it absolute.
    if (platform.isAbsolute(relative)) return undefined
    const rel = portable(relative)
    return rel === "" || rel === ".." || rel.startsWith("../") || rel === ".git" || rel.startsWith(".git/") ? undefined : rel
  }
  for (const { kind, path } of rows) {
    if (kind === "missing-metafile") throw new Error(`bundle-inputs: the bundler metafile was not written (${path}); the trace would under-report`)
    if (kind === "missing-bundle-rows") throw new Error(`bundle-inputs: recipe step '${path}' bundles but recorded no bundler inputs; the trace would under-report`)
    if (kind === "missing-module-hooks") throw new Error(`bundle-inputs: a module load ran without module hooks (${path}); the trace would under-report`)
    const rel = inRepo(path)
    if (rel === undefined || rel === BUNDLE_INPUTS_PATH) continue
    if (kind === "list") { directories.add(rel); continue }
    files.add(rel.split("/").includes("node_modules") ? "bun.lock" : rel)
  }
  for (const file of [...files]) {
    for (let dir = nodePath.posix.dirname(file); ; dir = nodePath.posix.dirname(dir)) {
      for (const name of RESOLUTION_FILES) {
        const candidate = dir === "." ? name : `${dir}/${name}`
        if (exists(platform.join(absRoot, ...candidate.split("/")))) files.add(candidate)
      }
      if (dir === ".") break
    }
  }
  return { files: [...files].sort(), directories: [...directories].sort() }
}

export function renderBundleInputs(map) {
  return `${JSON.stringify({
    "//": "Generated by packages/omo-senpi/plugin/scripts/bundle-inputs.mjs from a trace of the bundle recipe. Do not edit; run the script.",
    version: 1,
    files: map.files,
    directories: map.directories,
  }, null, 2)}\n`
}

export function traceBundleInputs() {
  const scratch = mkdtempSync(join(tmpdir(), "omo-bundle-inputs-"))
  const env = recipeEnv(scratch)
  const trace = env.OMO_BUNDLE_INPUTS_TRACE
  const readRows = () => (existsSync(trace) ? readFileSync(trace, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [])
  try {
    const rows = []
    let seen = 0
    for (const step of RECIPE) {
      const result = spawnSync(step.command, step.args, { cwd: repoRoot, env, stdio: ["ignore", "ignore", "inherit"] })
      if (result.error !== undefined) throw result.error
      if (result.status !== 0) throw new Error(`bundle-inputs: recipe step '${step.name}' exited ${result.status}`)
      // Steps run one at a time, so the rows appended since the last read are this step's.
      const all = readRows()
      rows.push(...checkStepRows(step, all.slice(seen)))
      seen = all.length
    }
    return mapFromTrace(rows, { repoRoot })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// Bun and npm set npm_lifecycle_event for lifecycle scripts; a fail-closed backstop should an install chain reach this script.
export const INSTALL_LIFECYCLES = ["prepare", "postinstall", "install"]

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lifecycle = process.env.npm_lifecycle_event
  if (lifecycle !== undefined && INSTALL_LIFECYCLES.includes(lifecycle)) {
    console.error(`bundle-inputs: refusing to trace during '${lifecycle}': the trace never runs during install; run bun run bundle-inputs`)
    process.exit(1)
  }
  const output = join(repoRoot, BUNDLE_INPUTS_PATH)
  try {
    const rendered = renderBundleInputs(traceBundleInputs())
    if (process.argv.includes("--check")) {
      const committed = existsSync(output) ? readFileSync(output, "utf8") : undefined
      if (committed !== rendered) {
        const want = JSON.parse(rendered)
        const have = committed === undefined ? { files: [], directories: [] } : JSON.parse(committed)
        const added = [...want.files, ...want.directories].filter((p) => !have.files.includes(p) && !have.directories.includes(p))
        const removed = [...have.files, ...have.directories].filter((p) => !want.files.includes(p) && !want.directories.includes(p))
        console.error(`${BUNDLE_INPUTS_PATH} is not current (${committed === undefined ? "missing" : `+${added.length} -${removed.length}`}): run bun run bundle-inputs`)
        for (const p of added.slice(0, 20)) console.error(`  + ${p}`)
        for (const p of removed.slice(0, 20)) console.error(`  - ${p}`)
        process.exit(1)
      }
      console.log(`${BUNDLE_INPUTS_PATH} is current`)
    } else {
      writeFileSync(output, rendered)
      console.log(`Wrote ${BUNDLE_INPUTS_PATH}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
