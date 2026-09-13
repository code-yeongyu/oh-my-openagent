#!/usr/bin/env bun
// Environment audit that every Kibitzer QA lane runs before a green result is trusted (plan
// .omo/plans/kibitzer-resident-sidecar.md, verification strategy "Environment hygiene").
//
// A `*_PACKAGE_DIR` variable (`OMO_PACKAGE_DIR`, `SENPI_PACKAGE_DIR`, `PI_PACKAGE_DIR` - the brand-scoped
// roots senpi reads as its own package directory, see worker/senpi-command.ts) that leaks into a lane
// makes the spawned senpi look for its shipped assets under a tree that never contained them, so an
// e2e can appear to run the artifact under test while it runs something else. The probe does not
// inspect its own environment: it spawns ONE child lane the way a driver would (this very bun, the
// caller's environment) and reads back what that lane actually sees, so the audit measures the
// environment a lane inherits rather than the environment the probe was started with.
//
//   --mode clean                       exit 0 only when the lane sees no `*_PACKAGE_DIR` at all;
//                                      the artifact names every variable inspected and its value.
//   --mode contaminated --set N=V      injects N=V into the probe's own child lane and expects the
//                                      lane to see it: exit 1 with a receipt naming the contaminating
//                                      variable(s). Exit 2 if the injected contamination was NOT
//                                      observed - then the probe itself is broken and nothing it
//                                      says about a clean lane can be trusted.
//
// Both modes accept --evidence-dir; the child lane is the only process spawned and it is killed on a
// bounded timeout, so the probe leaves nothing behind.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const DRIVER = "package-dir-hygiene-probe"
/** The names production code reads (worker/senpi-command.ts PACKAGE_DIR_ENV_NAMES); always inspected, set or not. */
export const KNOWN_PACKAGE_DIR_NAMES = ["OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR"]
/** Any other variable spelled like a package root is inspected as well - a brand added later must not slip through. */
export const PACKAGE_DIR_PATTERN = /_PACKAGE_DIR$/u
export const LANE_TIMEOUT_MS = 15_000
export const EXIT_CLEAN = 0
export const EXIT_CONTAMINATED = 1
export const EXIT_PROBE_BROKEN = 2

const scriptPath = fileURLToPath(import.meta.url)

export function parseArgs(argv) {
  const options = { mode: undefined, set: [], evidenceDir: undefined, laneReport: false, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--mode") options.mode = take()
    else if (arg === "--set") options.set.push(parseAssignment(take()))
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--lane-report") options.laneReport = true
    else if (arg === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.laneReport || options.selfTest) return options
  if (options.mode !== "clean" && options.mode !== "contaminated") throw new Error("--mode must be clean|contaminated")
  if (options.mode === "clean" && options.set.length > 0) throw new Error("--set is only valid with --mode contaminated")
  if (options.mode === "contaminated" && options.set.length === 0) throw new Error("--mode contaminated needs at least one --set NAME=VALUE")
  return options
}

/** `NAME=VALUE`; the name must itself be a package-dir variable, or the injection would audit nothing. */
export function parseAssignment(text) {
  const separator = text.indexOf("=")
  if (separator <= 0) throw new Error(`--set expects NAME=VALUE, got ${JSON.stringify(text)}`)
  const name = text.slice(0, separator)
  const value = text.slice(separator + 1)
  if (!PACKAGE_DIR_PATTERN.test(name)) throw new Error(`--set ${name}: only *_PACKAGE_DIR variables can be injected`)
  if (value.length === 0) throw new Error(`--set ${name}: an empty value would not contaminate the lane`)
  return { name, value }
}

export function packageDirEntries(env) {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => PACKAGE_DIR_PATTERN.test(name) && typeof value === "string"))
}

/**
 * The audit table: every known name, every package-dir variable the parent exports, every one the
 * lane reported and every injected one, with where it came from and what the lane saw.
 */
export function inspectPackageDirs({ parentEnv, laneEnv, injected }) {
  const parentDirs = packageDirEntries(parentEnv)
  const injectedNames = new Set(injected.map((entry) => entry.name))
  const names = new Set([...KNOWN_PACKAGE_DIR_NAMES, ...Object.keys(parentDirs), ...Object.keys(laneEnv), ...injectedNames])
  const inspected = [...names].sort().map((name) => {
    const laneValue = laneEnv[name]
    const source = injectedNames.has(name) ? "injected" : parentDirs[name] !== undefined ? "inherited" : laneValue !== undefined ? "lane-discovered" : "known"
    return { name, source, set: laneValue !== undefined, ...(laneValue === undefined ? {} : { value: laneValue }), ...(parentDirs[name] === undefined ? {} : { parentValue: parentDirs[name] }) }
  })
  const contaminating = inspected.filter((entry) => entry.set).map((entry) => entry.name)
  const unobserved = injected.filter((entry) => laneEnv[entry.name] !== entry.value).map((entry) => entry.name)
  return { inspected, contaminating, inherited: inspected.filter((entry) => entry.source === "inherited" && entry.set).map((entry) => entry.name), injected: [...injectedNames].sort(), unobserved }
}

/** Runs ONE child lane under this bun with `env` and returns the package-dir variables it sees. */
export function reportLane(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath, "--lane-report"], { env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`lane pid ${child.pid} did not report within ${LANE_TIMEOUT_MS}ms`))
    }, LANE_TIMEOUT_MS)
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error(`lane pid ${child.pid} exited code=${code} signal=${signal}: ${stderr.trim()}`)); return }
      try {
        const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "")
        resolvePromise({ pid: child.pid, exitCode: code, packageDirs: report.packageDirs, execPath: report.execPath })
      } catch (error) {
        reject(new Error(`lane pid ${child.pid} printed no report: ${error instanceof Error ? error.message : String(error)}; stdout=${stdout.slice(-300)}`))
      }
    })
  })
}

function writeArtifact(dir, name, payload) {
  if (dir === undefined) return undefined
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.laneReport) {
    process.stdout.write(`${JSON.stringify({ pid: process.pid, execPath: process.execPath, packageDirs: packageDirEntries(process.env) })}\n`)
    return
  }
  if (options.selfTest) { runSelfTest(); return }

  const laneEnv = { ...process.env }
  for (const entry of options.set) laneEnv[entry.name] = entry.value
  let lane
  try {
    lane = await reportLane(laneEnv)
  } catch (error) {
    const summary = { ok: false, driver: DRIVER, mode: options.mode, verdict: "probe-broken", reason: error instanceof Error ? error.message : String(error) }
    summary.artifact = writeArtifact(options.evidenceDir, "package-dir-hygiene.json", summary)
    console.log(JSON.stringify(summary))
    process.exit(EXIT_PROBE_BROKEN)
  }
  const audit = inspectPackageDirs({ parentEnv: process.env, laneEnv: lane.packageDirs, injected: options.set })
  for (const entry of audit.inspected) console.log(`${entry.set ? "SET  " : "unset"} ${entry.name} (${entry.source})${entry.set ? ` = ${entry.value}` : ""}`)

  const base = {
    driver: DRIVER,
    mode: options.mode,
    lane: { pid: lane.pid, exitCode: lane.exitCode, execPath: lane.execPath },
    inspected: audit.inspected,
    contaminating: audit.contaminating,
    inherited: audit.inherited,
    injected: audit.injected,
    cleanup: `lane pid ${lane.pid} exited`,
  }
  let summary
  let artifactName
  if (options.mode === "clean") {
    const exitCode = audit.contaminating.length === 0 ? EXIT_CLEAN : EXIT_CONTAMINATED
    summary = { ok: exitCode === EXIT_CLEAN, ...base, verdict: exitCode === EXIT_CLEAN ? "clean" : "contaminated", exitCode }
    artifactName = "package-dir-hygiene.json"
  } else if (audit.unobserved.length > 0) {
    // The injected variable never reached the lane: the probe cannot see contamination, so no
    // clean verdict from it means anything either.
    summary = { ok: false, ...base, verdict: "probe-broken", reason: `injected variable not observed by the lane: ${audit.unobserved.join(",")}`, exitCode: EXIT_PROBE_BROKEN }
    artifactName = "package-dir-contamination-receipt.json"
  } else {
    // The RED the lanes are gated on: the lane saw exactly what was injected, the probe is sound.
    summary = { ok: false, ...base, verdict: "contaminated", probe: "sound", exitCode: EXIT_CONTAMINATED }
    artifactName = "package-dir-contamination-receipt.json"
  }
  summary.artifact = writeArtifact(options.evidenceDir, artifactName, summary)
  console.log(JSON.stringify(summary))
  process.exit(summary.exitCode)
}

function runSelfTest() {
  const contaminated = parseArgs(["--mode", "contaminated", "--set", "SENPI_PACKAGE_DIR=/tmp/ulw-contaminated", "--evidence-dir", "/tmp/x"])
  if (contaminated.set[0]?.name !== "SENPI_PACKAGE_DIR" || contaminated.set[0]?.value !== "/tmp/ulw-contaminated") throw new Error("self-test: --set parsing")
  if (parseArgs(["--mode", "contaminated", "--set", "SENPI_PACKAGE_DIR=C:\\ulw-contaminated"]).set[0]?.value !== "C:\\ulw-contaminated") throw new Error("self-test: a Windows value survives parsing")
  for (const bad of [["--mode", "clean", "--set", "OMO_PACKAGE_DIR=/x"], ["--mode", "contaminated"], ["--mode", "other"], ["--mode", "contaminated", "--set", "HOME=/x"], ["--mode", "contaminated", "--set", "OMO_PACKAGE_DIR="]]) {
    let rejected = false
    try { parseArgs(bad) } catch { rejected = true }
    if (!rejected) throw new Error(`self-test: ${bad.join(" ")} must be rejected`)
  }
  if (JSON.stringify(packageDirEntries({ OMO_PACKAGE_DIR: "/a", HOME: "/h", FOO_PACKAGE_DIR: "/f", PACKAGE_DIR: "/p" })) !== JSON.stringify({ OMO_PACKAGE_DIR: "/a", FOO_PACKAGE_DIR: "/f" })) throw new Error("self-test: package-dir pattern")
  const clean = inspectPackageDirs({ parentEnv: { HOME: "/h" }, laneEnv: {}, injected: [] })
  if (clean.contaminating.length !== 0 || clean.inspected.map((entry) => entry.name).join(",") !== KNOWN_PACKAGE_DIR_NAMES.slice().sort().join(",")) throw new Error("self-test: a clean lane still lists every known name")
  const dirty = inspectPackageDirs({ parentEnv: { OMO_PACKAGE_DIR: "/real" }, laneEnv: { OMO_PACKAGE_DIR: "/real", SENPI_PACKAGE_DIR: "/tmp/ulw-contaminated", ACME_PACKAGE_DIR: "/acme" }, injected: [{ name: "SENPI_PACKAGE_DIR", value: "/tmp/ulw-contaminated" }] })
  if (dirty.contaminating.join(",") !== "ACME_PACKAGE_DIR,OMO_PACKAGE_DIR,SENPI_PACKAGE_DIR") throw new Error(`self-test: contaminating names ${dirty.contaminating.join(",")}`)
  const sources = Object.fromEntries(dirty.inspected.map((entry) => [entry.name, entry.source]))
  if (sources.OMO_PACKAGE_DIR !== "inherited" || sources.SENPI_PACKAGE_DIR !== "injected" || sources.ACME_PACKAGE_DIR !== "lane-discovered" || sources.PI_PACKAGE_DIR !== "known") throw new Error(`self-test: sources ${JSON.stringify(sources)}`)
  if (dirty.unobserved.length !== 0 || dirty.inherited.join(",") !== "OMO_PACKAGE_DIR") throw new Error("self-test: inherited/unobserved accounting")
  const lost = inspectPackageDirs({ parentEnv: {}, laneEnv: {}, injected: [{ name: "SENPI_PACKAGE_DIR", value: "/tmp/x" }] })
  if (lost.unobserved.join(",") !== "SENPI_PACKAGE_DIR") throw new Error("self-test: an injected variable the lane never saw must be reported as unobserved")
  console.log(JSON.stringify({ ok: true, driver: DRIVER, selfTest: true }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
