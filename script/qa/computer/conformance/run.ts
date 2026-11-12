import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

import { catalogFor, SESSIONS } from "./catalog.ts"
import { type Driver, isDriver } from "./driver.ts"
import { type ObserverStatus, observerCheck } from "./observer.ts"
import { type Check, executable, fakeStdio, preflight, type Probe } from "./preflight.ts"
import { buildReport, summaryLine } from "./report.ts"
import { MAX_REFERENCE_CELLS, TASKS } from "./taskset/tasks.ts"
import { type CellResult, OS_NAMES, type OsName, RUN_SCHEMA } from "./vocabulary.ts"

const REPO = resolve(import.meta.dir, "../../../..")
const SENTINEL = join(REPO, "script/qa/computer/sentinel/sentinel.ts")

type DriverName = "engine" | "legacy"
type DriverSlot = { readonly driver: Driver } | { readonly unavailable: string }

const NOT_YET: Readonly<Record<DriverName, string>> = {
  engine:
    "it needs the fake backend's fixture scenarios (cu-v3 row 14), the engine's --stdio session (row 15) and the verbs on the fake (rows 23-25)",
  legacy: "the shipped-runtime driver is built by the baseline row (row 8)",
}

async function loadDriver(name: DriverName): Promise<DriverSlot> {
  const file = join(import.meta.dir, "drivers", `${name}.ts`)
  const shown = relative(REPO, file)
  if (!existsSync(file)) return { unavailable: `${shown} is not present: ${NOT_YET[name]}` }
  const loaded: unknown = await import(file)
  const driver = typeof loaded === "object" && loaded !== null && "driver" in loaded ? loaded.driver : undefined
  return isDriver(driver) ? { driver } : { unavailable: `${shown} does not export a driver with runCell and runTask` }
}

interface Options {
  readonly os: OsName
  readonly session: string
  readonly mode: "catalog" | "taskset"
  readonly driver: DriverName
  readonly engine: string
  readonly out: string
}

function parse(argv: readonly string[]): Options | string {
  const value = (flag: string) => {
    const at = argv.indexOf(flag)
    return at >= 0 ? argv[at + 1] : undefined
  }
  const os = OS_NAMES.find((name) => name === value("--os"))
  if (os === undefined) return `--os must be one of ${OS_NAMES.join(", ")}`
  const mode = argv.includes("--taskset") ? "taskset" : argv.includes("--all") ? "catalog" : undefined
  if (mode === undefined) return "pass --all (the catalog) or --taskset"
  const driver = value("--driver") ?? "engine"
  if (driver !== "engine" && driver !== "legacy") return "--driver must be engine or legacy"
  return {
    os,
    session: value("--session") ?? SESSIONS[os],
    mode,
    driver,
    engine: resolve(value("--engine") ?? join(REPO, "target/debug/omo-computer-engine")),
    out: value("--out") ?? mkdtempSync(join(tmpdir(), "conformance-run-")),
  }
}

function probes(options: Options, slot: DriverSlot, observed: { check: Check }): Probe[] {
  const driverCheck: Probe = async () =>
    "driver" in slot
      ? { name: `driver-${options.driver}`, ok: true, detail: "cell runner present" }
      : { name: `driver-${options.driver}`, ok: false, detail: slot.unavailable }
  const observer: Probe = async () => observed.check
  if (options.driver === "legacy") return [driverCheck, observer]
  const engine = [executable(options.engine), fakeStdio(options.engine)]
  return options.os === "fake" ? [...engine, driverCheck] : [...engine, driverCheck, observer]
}

function unobserved(result: CellResult, reason: string): CellResult {
  const blind = { signal: "not_observed" as const, firstAt: null, count: 0 }
  const journal = {
    key_focus: blind,
    window_raised: blind,
    typing: blind,
    pointer: blind,
    clipboard: blind,
    space: blind,
    dialog: blind,
    activation: blind,
  }
  return { ...result, journal, observerUnavailable: reason }
}

async function runCatalog(options: Options, driver: Driver, status: ObserverStatus): Promise<number> {
  const catalog = catalogFor(options.os, options.session)
  const results: CellResult[] = []
  for (const cell of catalog) {
    const result = await driver.runCell(cell)
    results.push(status.kind === "unavailable" && options.os !== "fake" ? unobserved(result, status.reason) : result)
  }
  const run = { schema: RUN_SCHEMA, driver: options.driver, os: options.os, session: options.session, results }
  writeFileSync(join(options.out, "run.json"), JSON.stringify(run, null, 2))
  const report = buildReport(catalog, results)
  for (const problem of report.problems) console.log(problem)
  console.log(summaryLine(report))
  return report.problems.length === 0 ? 0 : 1
}

async function runTaskset(options: Options, driver: Driver): Promise<number> {
  let pass = 0
  for (const task of TASKS) {
    const outcome = await driver.runTask(task)
    const wrong = task.oracle.filter((expected) => outcome.saved[expected.field] !== expected.equals)
    if (wrong.length === 0 && outcome.cells <= MAX_REFERENCE_CELLS) pass += 1
    else
      console.log(
        `task ${task.id}: saved fields not as declared: ${wrong.map((w) => w.field).join(",") || "none"} cells=${outcome.cells}`,
      )
  }
  const most = Math.max(...TASKS.map((task) => task.cells.length))
  console.log(`TASKSET ${options.os} tasks=${TASKS.length} pass=${pass} reference_max_cells=${most}`)
  return pass === TASKS.length && most <= MAX_REFERENCE_CELLS ? 0 : 1
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parse(argv)
  if (typeof options === "string") {
    console.error(
      `usage: run.ts --os <os> (--all | --taskset) [--driver engine|legacy] [--engine <path>] [--out <dir>]\n${options}`,
    )
    return 2
  }
  mkdirSync(options.out, { recursive: true })
  rmSync(join(options.out, "run.json"), { force: true })
  const slot = await loadDriver(options.driver)
  const observed = await observerCheck(SENTINEL, options.os)
  const environment = await preflight(options, probes(options, slot, observed))
  writeFileSync(join(options.out, "environment.json"), JSON.stringify(environment, null, 2))
  if (environment.status === "ENVIRONMENT_ERROR" || !("driver" in slot)) {
    for (const check of environment.checks.filter((entry) => !entry.ok)) {
      console.log(`ENVIRONMENT_ERROR ${check.name}: ${check.detail}`)
    }
    console.log(
      `ENVIRONMENT_ERROR ${options.os}/${options.session} ${options.mode} record=${join(options.out, "environment.json")}`,
    )
    return 3
  }
  return options.mode === "catalog"
    ? runCatalog(options, slot.driver, observed.status)
    : runTaskset(options, slot.driver)
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
