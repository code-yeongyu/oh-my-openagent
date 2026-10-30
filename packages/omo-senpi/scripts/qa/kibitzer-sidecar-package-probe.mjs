#!/usr/bin/env bun
// Package probe of the resident Kibitzer packaging lane: the bridge between the two independent
// controls. kibitzer-sidecar-manifest-check.mjs judged the shipped artifact's bytes without starting
// anything; kibitzer-sidecar-recovery-probe.mjs starts an executable and drives one wake. This probe
// resolves WHICH executable would run that exact artifact and records it as the only line of
// `<evidence-dir>/omo-command.txt`, the file the recovery probe consumes through `--command-file`.
//
// The host of a local-path pi package is the senpi CLI the package resolves to from its own
// location: the same `@code-yeongyu/senpi/dist/cli.js` walk production performs when it launches a
// memory child (worker/senpi-command.ts `resolveInstalledSenpiCli`), anchored at the plugin root
// named by the manifest rather than at the source tree, so a relocated or foreign install cannot be
// mistaken for the shipped one. A `.js` entry runs under this very bun (`resolveCommand` in the
// shared harness applies the same rule), so the recorded path is the executable, not an interpreter.
//
// Everything here is probe-layer: nothing is started. The probe re-hashes the artifact so the
// recorded executable provably belongs to the bytes the manifest judged, refuses an exported
// `*_PACKAGE_DIR` (senpi would read it as its package root - the hygiene probe owns that lane), and
// exits non-zero with a named reason whenever no such executable resolves. On failure the command
// file is REMOVED, never left stale, so a downstream `--command-file` fails loudly.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const DRIVER = "kibitzer-sidecar-package-probe"
export const LAYER = "probe"
export const COMMAND_FILE = "omo-command.txt"
export const RECEIPT_FILE = "package-probe.json"
export const SENPI_PACKAGE = join("@code-yeongyu", "senpi")
export const SENPI_CLI_RELATIVE = join("dist", "cli.js")
/** Mirrors worker/senpi-command.ts PACKAGE_DIR_ENV_NAMES: roots senpi reads as its own package directory. */
export const PACKAGE_DIR_ENV_NAMES = ["OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR"]
/** The artifacts whose manifest digests must still describe the files on disk. */
export const ARTIFACTS = ["omo.js", "omo-task.js", "kibitzer-persona.md"]

export function parseArgs(argv) {
  const options = { manifest: undefined, evidenceDir: undefined, pluginRoot: undefined, senpiCli: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--manifest") options.manifest = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--plugin-root") options.pluginRoot = resolve(take())
    else if (arg === "--senpi-cli") options.senpiCli = resolve(take())
    else if (arg === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.selfTest) return options
  if (options.manifest === undefined) throw new Error("--manifest <manifest.json> is required (written by kibitzer-sidecar-manifest-check.mjs)")
  if (options.evidenceDir === undefined) throw new Error(`--evidence-dir <dir> is required (receives ${COMMAND_FILE})`)
  return options
}

function sha256File(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function canonical(path) {
  try { return realpathSync.native(path) } catch { return path }
}

/**
 * The senpi CLI the plugin at `pluginRoot` resolves to: the first `@code-yeongyu/senpi/dist/cli.js`
 * along the `node_modules` chain that starts at the plugin root itself. Returns the resolution trail
 * so the receipt shows every directory that was consulted, not only the winner.
 */
export function resolveHostExecutable(pluginRoot) {
  const require = createRequire(join(pluginRoot, "package.json"))
  const trail = []
  for (const modulesDir of require.resolve.paths(join(SENPI_PACKAGE, "package.json")) ?? []) {
    const candidate = join(modulesDir, SENPI_PACKAGE, SENPI_CLI_RELATIVE)
    const present = existsSync(candidate)
    trail.push({ modulesDir, present })
    if (present) return { executable: candidate, packageDir: join(modulesDir, SENPI_PACKAGE), trail }
  }
  return { executable: undefined, packageDir: undefined, trail }
}

/**
 * The senpi version `packages/omo-senpi/package.json` pins (the peer pin is the contract with the
 * host; the dev pin is what the repository installs), when the plugin root sits inside that package.
 */
export function readPinnedSenpiVersion(pluginRoot) {
  const manifestPath = join(dirname(pluginRoot), "package.json")
  if (!existsSync(manifestPath)) return { manifestPath, pin: undefined }
  try {
    const manifest = readJson(manifestPath)
    if (manifest?.name !== "@oh-my-opencode/omo-senpi") return { manifestPath, pin: undefined }
    for (const field of ["peerDependencies", "devDependencies", "dependencies"]) {
      const pin = manifest[field]?.["@code-yeongyu/senpi"]
      if (typeof pin === "string") return { manifestPath, pin, field }
    }
    return { manifestPath, pin: undefined }
  } catch {
    return { manifestPath, pin: undefined }
  }
}

/** Only an exact pin can be compared; a range or `workspace:` protocol is recorded, not judged. */
export function isExactVersion(pin) {
  return typeof pin === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(pin)
}

/**
 * Runs every probe check. Pure over the filesystem and the given environment: reads, hashes and
 * resolves; starts nothing. Returns the receipt payload; `main` decides what to write.
 */
export function probePackage({ manifestPath, pluginRootOverride, senpiCliOverride, env }) {
  const checks = []
  const reasons = []
  const record = (name, ok, detail, reason) => {
    checks.push({ layer: LAYER, name, ok, detail })
    if (!ok && reason !== undefined) reasons.push(reason)
    return ok
  }
  const facts = { manifest: manifestPath }

  // ---- the manifest control this probe extends ---------------------------------------------------------------
  let manifest
  if (!record("manifest.present", existsSync(manifestPath), `manifest=${manifestPath}`, "manifest-missing")) return finish()
  try {
    manifest = readJson(manifestPath)
    record("manifest.readable", true, `driver=${manifest?.driver} layer=${manifest?.layer}`)
  } catch (error) {
    record("manifest.readable", false, error instanceof Error ? error.message : String(error), "manifest-unreadable")
    return finish()
  }
  record("manifest.is-manifest-check-output", manifest?.driver === "kibitzer-sidecar-manifest-check" && typeof manifest?.pluginRoot === "string" && manifest?.artifacts !== undefined, `driver=${manifest?.driver} pluginRoot=${manifest?.pluginRoot}`, "manifest-not-manifest-check")
  record("manifest.control-green", manifest?.ok === true, `manifest.ok=${manifest?.ok} failures=${JSON.stringify(manifest?.failures ?? [])}`, "manifest-control-red")
  const pluginRoot = pluginRootOverride ?? (typeof manifest?.pluginRoot === "string" ? manifest.pluginRoot : undefined)
  facts.pluginRoot = pluginRoot
  if (!record("plugin-root.present", pluginRoot !== undefined && existsSync(join(pluginRoot, "package.json")) && existsSync(join(pluginRoot, "extensions")), `pluginRoot=${pluginRoot ?? "none"}`, "plugin-root-missing")) return finish()

  // ---- the artifact on disk is still the one the manifest judged ---------------------------------------------
  facts.artifacts = {}
  for (const name of ARTIFACTS) {
    const path = join(pluginRoot, "extensions", name)
    const actual = sha256File(path)
    const expected = manifest?.artifacts?.[name]?.sha256
    facts.artifacts[name] = { path, sha256: actual ?? null, manifestSha256: expected ?? null }
    record(`artifact.${name}.matches-manifest`, actual !== undefined && expected !== undefined && actual === expected, `actual=${actual ?? "missing"} manifest=${expected ?? "none"}`, `artifact-drift:${name}`)
  }
  facts.bundleSha256 = facts.artifacts["omo.js"].sha256

  // ---- the environment cannot redirect senpi's package root ---------------------------------------------------
  const exported = PACKAGE_DIR_ENV_NAMES.filter((name) => typeof env[name] === "string" && env[name].length > 0)
  facts.packageDirEnv = Object.fromEntries(exported.map((name) => [name, env[name]]))
  record("env.no-package-dir", exported.length === 0, exported.length === 0 ? `none of ${PACKAGE_DIR_ENV_NAMES.join(",")} exported` : `exported: ${exported.map((name) => `${name}=${env[name]}`).join(" ")} (run package-dir-hygiene-probe.mjs --mode clean first)`, "package-dir-contaminated")

  // ---- the executable that runs this plugin ----------------------------------------------------------------------
  let executable
  let packageDir
  if (senpiCliOverride !== undefined) {
    facts.resolution = { source: "senpi-cli-override", candidate: senpiCliOverride }
    executable = existsSync(senpiCliOverride) ? senpiCliOverride : undefined
    packageDir = executable === undefined ? undefined : resolve(dirname(executable), "..")
    record("host.resolved", executable !== undefined, `--senpi-cli ${senpiCliOverride} present=${executable !== undefined}`, "host-unresolved")
  } else {
    const resolved = resolveHostExecutable(pluginRoot)
    facts.resolution = { source: "plugin-root-node-modules-walk", trail: resolved.trail }
    executable = resolved.executable
    packageDir = resolved.packageDir
    record("host.resolved", executable !== undefined, executable === undefined ? `no ${SENPI_PACKAGE}/${SENPI_CLI_RELATIVE} along ${resolved.trail.map((step) => step.modulesDir).join(" -> ") || "an empty node_modules chain"}` : `${executable} (${resolved.trail.length} node_modules dir(s) consulted)`, "host-unresolved")
  }
  if (executable === undefined) return finish()
  const canonicalExecutable = canonical(executable)
  facts.executable = canonicalExecutable
  facts.executableAsResolved = executable
  facts.executableSha256 = sha256File(canonicalExecutable)
  let isFile = false
  try { isFile = statSync(canonicalExecutable).isFile() } catch { isFile = false }
  record("host.is-file", isFile && isAbsolute(canonicalExecutable), `${canonicalExecutable} isFile=${isFile} sha256=${facts.executableSha256 ?? "none"}`, "host-not-a-file")
  const runsUnderBun = /\.(?:m?js|cjs)$/u.test(canonicalExecutable)
  facts.interpreter = runsUnderBun ? process.execPath : null
  record("host.runnable-shape", runsUnderBun || isFile, runsUnderBun ? `script entry; runs under ${process.execPath}` : "native executable; runs directly", "host-not-runnable")

  // ---- the host's identity against the package pin -----------------------------------------------------------------
  let hostPackage
  try { hostPackage = packageDir === undefined ? undefined : readJson(join(packageDir, "package.json")) } catch { hostPackage = undefined }
  facts.host = { name: hostPackage?.name ?? null, version: hostPackage?.version ?? null, bin: hostPackage?.bin ?? null, packageDir: packageDir === undefined ? null : canonical(packageDir) }
  record("host.package-identified", hostPackage?.name === "@code-yeongyu/senpi" && typeof hostPackage?.version === "string", `name=${hostPackage?.name ?? "none"} version=${hostPackage?.version ?? "none"}`, "host-package-unidentified")
  const binEntry = typeof hostPackage?.bin === "string" ? hostPackage.bin : hostPackage?.bin?.senpi
  record("host.is-declared-bin", typeof binEntry === "string" && packageDir !== undefined && canonical(resolve(packageDir, binEntry)) === canonicalExecutable, `bin.senpi=${JSON.stringify(binEntry ?? null)}`, "host-not-declared-bin")
  const pinned = readPinnedSenpiVersion(pluginRoot)
  facts.pin = { manifestPath: pinned.manifestPath, pin: pinned.pin ?? null, field: pinned.field ?? null, exact: isExactVersion(pinned.pin) }
  record("host.version-matches-pin", !isExactVersion(pinned.pin) || pinned.pin === hostPackage?.version, `pin=${pinned.pin ?? "none"} host=${hostPackage?.version ?? "none"}${isExactVersion(pinned.pin) ? "" : " (pin not exact; recorded, not judged)"}`, "senpi-version-drift")
  return finish()

  function finish() {
    const failures = checks.filter((check) => !check.ok)
    return {
      ok: failures.length === 0 && facts.executable !== undefined,
      layer: LAYER,
      driver: DRIVER,
      ...facts,
      checks,
      failures: failures.map((check) => check.name),
      reasons,
    }
  }
}

function writeEvidence(dir, name, body) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, body)
  return file
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) { runSelfTest(); return }
  const payload = probePackage({ manifestPath: options.manifest, pluginRootOverride: options.pluginRoot, senpiCliOverride: options.senpiCli, env: process.env })
  for (const check of payload.checks) console.log(`${check.ok ? "PASS" : "FAIL"} [${check.layer}] ${check.name} :: ${check.detail}`)

  const commandFile = join(options.evidenceDir, COMMAND_FILE)
  if (payload.ok) {
    writeEvidence(options.evidenceDir, COMMAND_FILE, `${payload.executable}\n`)
    payload.commandFile = commandFile
  } else {
    rmSync(commandFile, { force: true })
    payload.commandFile = null
  }
  payload.receipt = writeEvidence(options.evidenceDir, RECEIPT_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`evidence: ${payload.receipt}`)
  console.log(JSON.stringify({
    ok: payload.ok,
    layer: LAYER,
    driver: DRIVER,
    manifest: payload.manifest,
    pluginRoot: payload.pluginRoot ?? null,
    bundleSha256: payload.bundleSha256 ?? null,
    executable: payload.executable ?? null,
    interpreter: payload.interpreter ?? null,
    senpiVersion: payload.host?.version ?? null,
    pinnedVersion: payload.pin?.pin ?? null,
    commandFile: payload.commandFile,
    checks: payload.checks.length,
    failures: payload.failures,
    reasons: payload.reasons,
  }))
  process.exit(payload.ok ? 0 : 1)
}

function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "kibitzer-package-probe-self-test-"))
  try {
    // A plugin root whose own node_modules chain carries a senpi: the walk must find THAT one, first.
    const pluginRoot = join(root, "pkg", "plugin")
    mkdirSync(join(pluginRoot, "extensions"), { recursive: true })
    writeFileSync(join(pluginRoot, "package.json"), `${JSON.stringify({ name: "@code-yeongyu/omo-senpi", type: "module", pi: { extensions: ["./extensions/omo.js"] } })}\n`)
    writeFileSync(join(root, "pkg", "package.json"), `${JSON.stringify({ name: "@oh-my-opencode/omo-senpi", peerDependencies: { "@code-yeongyu/senpi": "2026.9.11" } })}\n`)
    const senpiDir = join(root, "node_modules", "@code-yeongyu", "senpi")
    mkdirSync(join(senpiDir, "dist"), { recursive: true })
    writeFileSync(join(senpiDir, "package.json"), `${JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.11", bin: { senpi: "dist/cli.js" } })}\n`)
    writeFileSync(join(senpiDir, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('fake senpi')\n")
    const resolved = resolveHostExecutable(pluginRoot)
    if (canonical(resolved.executable ?? "") !== canonical(join(senpiDir, "dist", "cli.js"))) throw new Error(`self-test: resolution found ${resolved.executable}`)
    if (!resolved.trail.some((step) => step.present) || resolved.trail[0].present) throw new Error("self-test: the trail must show the plugin-local node_modules consulted first and the winner later")
    if (readPinnedSenpiVersion(pluginRoot).pin !== "2026.9.11" || readPinnedSenpiVersion(pluginRoot).field !== "peerDependencies" || !isExactVersion("2026.9.11") || isExactVersion("^1.2.3") || isExactVersion("workspace:*")) throw new Error("self-test: pin reading")

    for (const name of ARTIFACTS) writeFileSync(join(pluginRoot, "extensions", name), `${name} bytes\n`)
    const artifacts = Object.fromEntries(ARTIFACTS.map((name) => [name, { sha256: createHash("sha256").update(readFileSync(join(pluginRoot, "extensions", name))).digest("hex") }]))
    const manifestPath = join(root, "manifest.json")
    writeFileSync(manifestPath, `${JSON.stringify({ ok: true, driver: "kibitzer-sidecar-manifest-check", pluginRoot, artifacts })}\n`)
    const green = probePackage({ manifestPath, env: {} })
    if (!green.ok || canonical(green.executable) !== canonical(join(senpiDir, "dist", "cli.js")) || green.interpreter !== process.execPath) throw new Error(`self-test: green probe failed: ${JSON.stringify(green.failures)} ${JSON.stringify(green.reasons)}`)

    const contaminated = probePackage({ manifestPath, env: { SENPI_PACKAGE_DIR: "/tmp/ulw-contaminated" } })
    if (contaminated.ok || !contaminated.reasons.includes("package-dir-contaminated")) throw new Error("self-test: an exported *_PACKAGE_DIR must fail the probe")
    writeFileSync(join(pluginRoot, "extensions", "omo.js"), "drifted\n")
    const drifted = probePackage({ manifestPath, env: {} })
    if (drifted.ok || !drifted.reasons.includes("artifact-drift:omo.js")) throw new Error("self-test: a rebuilt bundle must be reported as drift against the manifest")
    writeFileSync(join(pluginRoot, "extensions", "omo.js"), "omo.js bytes\n")
    writeFileSync(join(senpiDir, "package.json"), `${JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.10", bin: { senpi: "dist/cli.js" } })}\n`)
    const olderHost = probePackage({ manifestPath, env: {} })
    if (olderHost.ok || !olderHost.reasons.includes("senpi-version-drift")) throw new Error("self-test: a host older than the exact pin must be reported as version drift")
    writeFileSync(join(senpiDir, "package.json"), `${JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.11", bin: { senpi: "dist/cli.js" } })}\n`)
    const missing = probePackage({ manifestPath: join(root, "absent.json"), env: {} })
    if (missing.ok || missing.reasons[0] !== "manifest-missing") throw new Error("self-test: a missing manifest is a probe-layer reason")
    rmSync(senpiDir, { recursive: true, force: true })
    const unresolved = probePackage({ manifestPath, env: {} })
    if (unresolved.ok || !unresolved.reasons.includes("host-unresolved") || unresolved.executable !== undefined) throw new Error("self-test: no senpi along the chain must be host-unresolved with no executable")
    const overridden = probePackage({ manifestPath, senpiCliOverride: join(root, "nowhere", "cli.js"), env: {} })
    if (overridden.ok || !overridden.reasons.includes("host-unresolved")) throw new Error("self-test: a missing --senpi-cli is host-unresolved")
    if (parseArgs(["--manifest", "m.json", "--evidence-dir", "e"]).manifest !== resolve("m.json")) throw new Error("self-test: argument parsing")
    let rejected = false
    try { parseArgs(["--manifest", "m.json"]) } catch { rejected = true }
    if (!rejected) throw new Error("self-test: --evidence-dir is required")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  console.log(JSON.stringify({ ok: true, driver: DRIVER, selfTest: true }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
