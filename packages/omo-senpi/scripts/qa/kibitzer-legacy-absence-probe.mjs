#!/usr/bin/env bun
// Proves the one-shot Kibitzer machinery is gone - from the source tree AND from the packaged
// artifact - and that nothing came back under another name: no per-launch judge modules, no
// candidate-set fingerprint, launch ceiling, trailing/busy slot, process-wide judge slot or
// compaction-epoch verdict drop, no per-run `recall/runs/` artifacts, no engine switch, and none of
// the retired one-shot QA drivers. Test-only: it emits no production diagnostic.
//
// Source findings are reported with layer "source" (identifier matches with file:line), artifact
// findings with layer "artifact" (string literals in the shipped bundles). Markdown and test files
// are never a failure: historical prose may name what was removed and a compatibility test may keep
// a legacy record as fixture data (test data, never production code), so both are listed separately.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const SELF = basename(fileURLToPath(import.meta.url))

export const DEFAULT_PLUGIN_ROOT = join(packageRoot, "plugin")
export const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]
export const SCAN_ROOTS = [
  join("packages", "omo-senpi", "src"),
  join("packages", "memory-core", "src"),
  join("packages", "omo-config-core", "src"),
  join("packages", "omo-senpi", "scripts", "qa"),
  join("packages", "omo-senpi", "plugin", "scripts"),
]
/** The one-shot judge modules the flip deleted; a move would only relocate them, so any depth counts. */
export const ONE_SHOT_MODULES = [
  "kibitzer-trigger.ts",
  "kibitzer-runner.ts",
  "kibitzer-runner.fallback-support.ts",
  "kibitzer-judge-run.ts",
  "kibitzer-judge-spec.ts",
  "kibitzer-prompt.ts",
  "kibitzer-concurrency.ts",
  "kibitzer-lifecycle.ts",
  "kibitzer-run-retention.ts",
  "kibitzer-wiring.ts",
]
/** Identifiers unique to the removed machinery; matched on word boundaries in production code anywhere. */
export const ONE_SHOT_SYMBOLS = ["MAX_LAUNCHES_PER_SESSION", "busySessions", "tryAcquireJudgeSlot"]
export const COMPACTION_EPOCH_SYMBOLS = ["compactionEpoch"]
/** Per-run artifact literals of the one-shot judge (`recall/runs/<uuid>/candidates.json`). */
export const PER_RUN_LITERALS = ["recall/runs", "candidates.json"]
export const DUAL_MODE_LITERALS = ["OMO_KIBITZER_ENGINE"]
/**
 * Generic names the one-shot judge used (`activeLaunch` is a legitimate facts-runner field and the
 * memory status line keeps its own `lastFingerprint`): only the recall path must not carry them.
 */
export const RECALL_PATH_ONLY_SYMBOLS = ["activeLaunch", "lastFingerprint"]
export const RECALL_PATHS = [
  join("packages", "omo-senpi", "src", "components", "memory", "kibitzer"),
  join("packages", "omo-senpi", "src", "components", "memory", "recall-wiring.ts"),
  join("packages", "omo-senpi", "src", "components", "memory", "recall-drain.ts"),
  join("packages", "omo-senpi", "src", "components", "memory", "recall-session-read.ts"),
  join("packages", "memory-core", "src", "recall"),
]
/**
 * The retired one-shot QA drivers and their support module, assembled from parts so a repository-wide
 * search for a retired name finds nothing at all - this probe included.
 */
export const STALE_DRIVERS = ["gate-e2e", "tool-boundary-e2e", "tool-boundary-e2e-scenarios", "persistent-failure-e2e", "e2e-support"]
  .map((stem) => ["kibitzer", `${stem}.mjs`].join("-"))
export const ARTIFACTS = ["omo.js", "omo-task.js", "memory-run-supervisor.mjs"]
export const ARTIFACT_LITERALS = [...ONE_SHOT_SYMBOLS, ...COMPACTION_EPOCH_SYMBOLS, ...PER_RUN_LITERALS, ...DUAL_MODE_LITERALS]

export function parseArgs(argv) {
  const options = { source: repoRoot, pluginRoot: DEFAULT_PLUGIN_ROOT, evidenceDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--source") options.source = resolve(take())
    else if (arg === "--plugin-root") options.pluginRoot = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

export function walk(root, files = []) {
  if (!existsSync(root)) return files
  if (statSync(root).isFile()) { files.push(root); return files }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) walk(path, files)
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const isCode = (file) => CODE_EXTENSIONS.some((extension) => file.endsWith(extension))
const isMarkdown = (file) => file.endsWith(".md")
const isTest = (file) => /\.test\.[cm]?[jt]sx?$|\.test-support\.ts$|(?:^|[/\\])test-support\.ts$/u.test(file)

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")
}

/** `file:line` for every line of `files` that matches the needle (identifier boundary for symbols, plain for paths). */
export function findMatches(files, needle, { identifier }, root) {
  const pattern = identifier ? new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(needle)}(?![A-Za-z0-9_$])`, "u") : undefined
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    if (identifier ? !pattern.test(text) : !text.includes(needle)) continue
    text.split("\n").forEach((line, index) => {
      if (identifier ? pattern.test(line) : line.includes(needle)) hits.push(`${relative(root, file).split(sep).join("/")}:${index + 1}`)
    })
  }
  return hits
}

export function probe({ source, pluginRoot }) {
  const checks = []
  const record = (layer, name, ok, detail) => { checks.push({ layer, name, ok, detail }); return ok }
  const scanned = SCAN_ROOTS.flatMap((root) => walk(join(source, root))).filter((file) => basename(file) !== SELF)
  const code = scanned.filter((file) => isCode(file) && !isTest(file))
  const tests = scanned.filter((file) => isCode(file) && isTest(file))
  const markdown = scanned.filter(isMarkdown)
  const rel = (file) => relative(source, file).split(sep).join("/")

  // ---- source: modules ---------------------------------------------------------------------------------------------
  const survivingModules = walk(join(source, "packages", "omo-senpi", "src")).filter((file) => {
    const name = basename(file)
    return ONE_SHOT_MODULES.some((module) => name === module || name === module.replace(/\.ts$/u, ".test.ts"))
  }).map(rel)
  record("source", "one-shot-modules-absent", survivingModules.length === 0, survivingModules.length === 0 ? `none of ${ONE_SHOT_MODULES.length} one-shot modules exist under packages/omo-senpi/src` : `present: ${survivingModules.join(", ")}`)

  // ---- source: identifiers and literals --------------------------------------------------------------------------
  const matches = {}
  const scan = (needles, identifier, files = code) => Object.fromEntries(needles.map((needle) => [needle, findMatches(files, needle, { identifier }, source)]))
  matches.oneShot = scan(ONE_SHOT_SYMBOLS, true)
  matches.compactionEpoch = scan(COMPACTION_EPOCH_SYMBOLS, true)
  matches.perRun = scan(PER_RUN_LITERALS, false)
  matches.dualMode = scan(DUAL_MODE_LITERALS, false)
  const recallFiles = RECALL_PATHS.flatMap((path) => walk(join(source, path))).filter((file) => isCode(file) && !isTest(file) && basename(file) !== SELF)
  matches.recallPath = scan(RECALL_PATH_ONLY_SYMBOLS, true, recallFiles)
  const flat = (group) => Object.values(group).flat()
  record("source", "one-shot-symbols-absent", flat(matches.oneShot).length === 0, flat(matches.oneShot).length === 0 ? `${ONE_SHOT_SYMBOLS.join(", ")}: no production-code match in ${code.length} files` : flat(matches.oneShot).join(", "))
  record("source", "compaction-epoch-absent", flat(matches.compactionEpoch).length === 0, flat(matches.compactionEpoch).length === 0 ? `compactionEpoch: no production-code match` : flat(matches.compactionEpoch).join(", "))
  record("source", "per-run-artifacts-absent", flat(matches.perRun).length === 0, flat(matches.perRun).length === 0 ? `${PER_RUN_LITERALS.join(", ")}: no production-code match` : flat(matches.perRun).join(", "))
  record("source", "dual-mode-switch-absent", flat(matches.dualMode).length === 0, flat(matches.dualMode).length === 0 ? `${DUAL_MODE_LITERALS.join(", ")}: no production-code match` : flat(matches.dualMode).join(", "))
  record("source", "recall-path-launch-slot-absent", flat(matches.recallPath).length === 0, flat(matches.recallPath).length === 0 ? `${RECALL_PATH_ONLY_SYMBOLS.join(", ")}: no match in ${recallFiles.length} recall-path files` : flat(matches.recallPath).join(", "))

  // ---- source: retired drivers ---------------------------------------------------------------------------------------
  const qaDir = join(source, "packages", "omo-senpi", "scripts", "qa")
  const staleFiles = STALE_DRIVERS.filter((name) => existsSync(join(qaDir, name)))
  const staleReferences = Object.fromEntries(STALE_DRIVERS.map((name) => [name, findMatches([...code, ...tests, ...markdown], name, { identifier: false }, source)]))
  record("source", "stale-drivers-absent", staleFiles.length === 0, staleFiles.length === 0 ? `none of ${STALE_DRIVERS.length} retired drivers exist in scripts/qa` : `present: ${staleFiles.join(", ")}`)
  record("source", "stale-drivers-unreferenced", flat(staleReferences).length === 0, flat(staleReferences).length === 0 ? `no code, test or AGENTS reference to a retired driver in ${code.length + tests.length + markdown.length} files` : flat(staleReferences).join(", "))

  // ---- markdown and test fixtures: informational only ------------------------------------------------------------
  const legacyNeedles = [...ONE_SHOT_SYMBOLS, ...COMPACTION_EPOCH_SYMBOLS, ...PER_RUN_LITERALS, ...DUAL_MODE_LITERALS]
  const historicalMentions = scan(legacyNeedles, false, markdown)
  const testFixtureMentions = scan(legacyNeedles, false, tests)

  // ---- artifact ----------------------------------------------------------------------------------------------------------
  const artifacts = {}
  for (const name of ARTIFACTS) {
    const file = join(pluginRoot, "extensions", name)
    if (!existsSync(file)) {
      artifacts[name] = { present: false, literals: [] }
      record("artifact", `${name}.present`, false, `missing ${file}`)
      continue
    }
    const text = readFileSync(file, "utf8")
    const found = ARTIFACT_LITERALS.filter((literal) => text.includes(literal))
    artifacts[name] = { present: true, bytes: text.length, literals: found }
    record("artifact", `${name}.legacy-literals-absent`, found.length === 0, found.length === 0 ? `none of ${ARTIFACT_LITERALS.length} legacy literals in ${name}` : `found in ${name}: ${found.join(", ")}`)
  }

  const failures = checks.filter((check) => !check.ok)
  return {
    ok: failures.length === 0,
    driver: "kibitzer-legacy-absence-probe",
    source,
    pluginRoot,
    scanned: { code: code.length, tests: tests.length, markdown: markdown.length, roots: SCAN_ROOTS },
    legacy_runtime: survivingModules.length > 0 || flat(matches.oneShot).length > 0 || flat(matches.recallPath).length > 0 || Object.values(artifacts).some((artifact) => artifact.literals.some((literal) => ONE_SHOT_SYMBOLS.includes(literal))),
    compaction_epoch: flat(matches.compactionEpoch).length > 0 || Object.values(artifacts).some((artifact) => artifact.literals.includes("compactionEpoch")),
    per_run_artifacts: flat(matches.perRun).length > 0 || Object.values(artifacts).some((artifact) => artifact.literals.some((literal) => PER_RUN_LITERALS.includes(literal))),
    dual_mode: flat(matches.dualMode).length > 0 || Object.values(artifacts).some((artifact) => artifact.literals.some((literal) => DUAL_MODE_LITERALS.includes(literal))),
    stale_drivers: staleFiles.length > 0 || flat(staleReferences).length > 0,
    matches: { ...matches, staleReferences, historicalMentions, testFixtureMentions },
    artifacts,
    checks,
    failures: failures.map((check) => `${check.layer}:${check.name}`),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const payload = probe(options)
  for (const check of payload.checks) console.log(`${check.ok ? "PASS" : "FAIL"} [${check.layer}] ${check.name} :: ${check.detail}`)
  let evidence
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    evidence = join(options.evidenceDir, "legacy-absence.json")
    writeFileSync(evidence, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`evidence: ${evidence}`)
  }
  console.log(JSON.stringify({
    ok: payload.ok,
    driver: payload.driver,
    legacy_runtime: payload.legacy_runtime,
    compaction_epoch: payload.compaction_epoch,
    per_run_artifacts: payload.per_run_artifacts,
    dual_mode: payload.dual_mode,
    stale_drivers: payload.stale_drivers,
    scanned: payload.scanned,
    historicalMentions: Object.values(payload.matches.historicalMentions).flat().length,
    testFixtureMentions: Object.values(payload.matches.testFixtureMentions).flat().length,
    checks: payload.checks.length,
    failures: payload.failures,
    ...(evidence === undefined ? {} : { evidence }),
  }))
  process.exit(payload.ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
