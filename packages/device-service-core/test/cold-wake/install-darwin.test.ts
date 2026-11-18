import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { type ColdWakeHost, installColdWake, uninstallColdWake } from "../../src/cold-wake/index.ts"
import type { RunCommand } from "../../src/install.ts"
import { actions, fakeOmoHost, LAUNCH, OMO, ok, removeTempHomes, tempHome } from "./cold-wake-fakes.ts"

// omo#13594 on macOS: the session host is a LaunchAgent, and the device service's table lives in its own plist, so a
// table change reloads that job with a bootout and a bootstrap. The fake keeps the state launchd and plutil would keep.

afterEach(removeTempHomes)

const LABEL_PLIST = (home: string, label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`)

const RELAYD_JOB = "gui/501/ai.omo.relay-daemon"

type Interloper = { readonly at: "bootout" | "bootstrap" | "settle"; readonly keepsTable: boolean }

/**
 * launchctl and plutil over one in-memory table value; the relayd plist file only has to exist, and its job starts
 * loaded (pid 100). As launchd does, a bootstrap of a loaded job fails with "5: Input/output error". `lingerPrints`: a
 * booted-out job still prints as loaded, with its old pid, that many times. `interloper`: another writer (omo#14069,
 * OmO Desktop's device-service reinstall) loads the device service job once, right after omo's bootout, right before
 * omo's bootstrap, or after omo's bootstrap succeeded ("settle"), from a plist that kept or dropped the table.
 */
function fakeLaunchd(
  options: {
    readonly bootstrapFailures?: number
    readonly lingerPrints?: number
    readonly interloper?: Interloper
  } = {},
) {
  const home = tempHome("cwd-")
  const relayd = LABEL_PLIST(home, "ai.omo.relay-daemon")
  mkdirSync(dirname(relayd), { recursive: true })
  writeFileSync(relayd, "<plist/>")
  const state = {
    table: undefined as string | undefined,
    jobs: new Map<string, string>([[RELAYD_JOB, "100"]]),
    failures: options.bootstrapFailures ?? 0,
    lingering: undefined as { job: string; pid: string; prints: number } | undefined,
    nextPid: 200,
  }
  let interloper = options.interloper
  let relaydBootstrapped = false
  const interlope = (at: Interloper["at"]) => {
    if (interloper?.at !== at || (at !== "settle" && state.jobs.has(RELAYD_JOB))) return
    if (!interloper.keepsTable) state.table = undefined
    state.jobs.set(RELAYD_JOB, "900")
    state.lingering = undefined
    interloper = undefined
  }
  const eio = { exitCode: 5, output: "Bootstrap failed: 5: Input/output error" }
  const runs: string[] = []
  const omo = fakeOmoHost(true)
  const run: RunCommand = async (argv) => {
    runs.push(argv.join(" "))
    if (argv[0] === "/usr/bin/env") return omo.answer(argv)
    const [tool, verb, target = "", value] = argv
    if (tool === "plutil" && verb === "-extract" && target !== "EnvironmentVariables" && relaydBootstrapped)
      interlope("settle")
    if (tool === "plutil" && verb === "-extract")
      return target === "EnvironmentVariables" || state.table !== undefined
        ? ok(`${state.table ?? ""}\n`)
        : { exitCode: 1, output: "No value at that key path" }
    if (tool === "plutil" && verb === "-replace") state.table = argv[4]
    if (tool === "plutil" && verb === "-remove") state.table = undefined
    if (tool !== "launchctl") return ok()
    const lingering = state.lingering?.job === target && state.lingering.prints > 0 ? state.lingering : undefined
    if (verb === "print") {
      const pid = state.jobs.get(target)
      if (pid !== undefined) return ok(`\tstate = running\n\tpid = ${pid}\n`)
      if (lingering === undefined) return { exitCode: 113, output: "not found" }
      lingering.prints--
      return ok(`\tstate = running\n\tpid = ${lingering.pid}\n`)
    }
    if (verb === "bootout") {
      const pid = state.jobs.get(target)
      state.jobs.delete(target)
      if (pid !== undefined) state.lingering = { job: target, pid, prints: options.lingerPrints ?? 0 }
      interlope("bootout")
    }
    if (verb === "bootstrap") {
      const job = `${target}/${value?.endsWith("ai.omo.session-host.plist") ? "ai.omo.session-host" : "ai.omo.relay-daemon"}`
      if (job === RELAYD_JOB) interlope("bootstrap")
      const stillLeaving = state.lingering?.job === job && state.lingering.prints > 0
      if (stillLeaving || state.jobs.has(job) || state.failures-- > 0) return eio
      state.jobs.set(job, String(state.nextPid++))
      if (job === RELAYD_JOB) relaydBootstrapped = true
    }
    return ok()
  }
  const host: ColdWakeHost = { platform: "darwin", home, uid: 501, run, pause: async () => {} }
  return { host, home, runs, state, relayd, omo }
}

const relaydBootstraps = (runs: readonly string[]) =>
  runs.filter((r) => r.startsWith("launchctl bootstrap") && r.endsWith("ai.omo.relay-daemon.plist"))

describe("cold wake on macOS", () => {
  test("loads the LaunchAgent (it runs at load), writes the entry into the device service's plist and reloads that job", async () => {
    const { host, home, runs, state, relayd } = fakeLaunchd()
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    const plist = LABEL_PLIST(home, "ai.omo.session-host")
    expect(readFileSync(plist, "utf8")).toContain("<string>ai.omo.session-host</string>")
    expect(JSON.parse(state.table ?? "")).toEqual({ omo: { launchd: "ai.omo.session-host", senders: [] } })
    expect(runs.slice(0, 10)).toEqual([
      "launchctl print gui/501/ai.omo.session-host",
      "launchctl enable gui/501/ai.omo.session-host",
      `launchctl bootstrap gui/501 ${plist}`,
      `plutil -extract EnvironmentVariables.OMO_RELAYD_SERVICES raw -o - ${relayd}`,
      `plutil -extract EnvironmentVariables xml1 -o - ${relayd}`,
      `plutil -replace EnvironmentVariables.OMO_RELAYD_SERVICES -string ${state.table} ${relayd}`,
      `launchctl print ${RELAYD_JOB}`,
      `launchctl bootout ${RELAYD_JOB}`,
      `launchctl print ${RELAYD_JOB}`,
      `launchctl bootstrap gui/501 ${relayd}`,
    ])
    // Then it watches the plist's table while the restart settles.
    expect(new Set(runs.slice(10))).toEqual(
      new Set([`plutil -extract EnvironmentVariables.OMO_RELAYD_SERVICES raw -o - ${relayd}`]),
    )
    expect(state.jobs.get(RELAYD_JOB)).not.toBe("100")
  })

  // omo#14069: OmO Desktop reinstalls the device service when it stops, rewriting its plist and loading the job between
  // omo's bootout and bootstrap; a bootstrap of the now-loaded job can only fail with EIO 5.
  test.each([
    { at: "bootout", keepsTable: true, outcome: { kind: "installed", serviceRestarted: true }, bootstraps: 0 },
    { at: "bootout", keepsTable: false, outcome: { kind: "service_replaced" }, bootstraps: 0 },
    { at: "bootstrap", keepsTable: true, outcome: { kind: "installed", serviceRestarted: true }, bootstraps: 1 },
    { at: "bootstrap", keepsTable: false, outcome: { kind: "service_replaced" }, bootstraps: 1 },
    { at: "settle", keepsTable: true, outcome: { kind: "installed", serviceRestarted: true }, bootstraps: 1 },
    { at: "settle", keepsTable: false, outcome: { kind: "service_replaced" }, bootstraps: 1 },
  ] as const)(
    "a job another writer loads at our $at is judged by its plist (table kept: $keepsTable), never re-bootstrapped",
    async ({ at, keepsTable, outcome, bootstraps }) => {
      const { host, runs } = fakeLaunchd({ interloper: { at, keepsTable } })
      expect(await installColdWake(host, LAUNCH)).toEqual(outcome)
      expect(relaydBootstraps(runs)).toHaveLength(bootstraps)
    },
  )

  test("waits for a booted-out job to leave before it bootstraps the device service again", async () => {
    const { host, runs } = fakeLaunchd({ lingerPrints: 3 })
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    const relaydRuns = runs.filter((r) => r.startsWith("launchctl") && r.includes("relay-daemon"))
    expect(relaydRuns.slice(relaydRuns.indexOf(`launchctl bootout ${RELAYD_JOB}`) + 1)).toEqual([
      ...Array.from({ length: 4 }, () => `launchctl print ${RELAYD_JOB}`),
      expect.stringMatching(/^launchctl bootstrap gui\/501 .*ai\.omo\.relay-daemon\.plist$/),
    ])
  })

  test("a job still running its old process after the wait fails the restart instead of bootstrapping over it", async () => {
    const { host, runs } = fakeLaunchd({ lingerPrints: Number.POSITIVE_INFINITY })
    expect(await installColdWake(host, LAUNCH)).toMatchObject({ kind: "failed", step: "service_restart" })
    expect(relaydBootstraps(runs)).toEqual([])
  })

  test("a second install only checks: the job is loaded and the entry is there", async () => {
    const { host, runs, relayd } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(runs).toEqual([
      "launchctl print gui/501/ai.omo.session-host",
      `plutil -extract EnvironmentVariables.OMO_RELAYD_SERVICES raw -o - ${relayd}`,
    ])
  })

  test("re-applies the entry a device service update dropped from its plist", async () => {
    const { host, state } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    state.table = undefined
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    expect(JSON.parse(state.table ?? "")).toEqual({ omo: { launchd: "ai.omo.session-host", senders: [] } })
  })

  test("retries a bootstrap that races the bootout before it succeeds", async () => {
    const { host, runs } = fakeLaunchd({ bootstrapFailures: 2 })
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    expect(runs.filter((r) => r.includes("bootstrap gui/501") && r.includes("session-host"))).toHaveLength(3)
  })

  test("uninstall with no LaunchAgent installed asks for no host and drains none", async () => {
    const { host, runs, omo } = fakeLaunchd()
    await uninstallColdWake(host, LAUNCH)
    expect(omo.state.running).toBe(true)
    expect(runs.filter((r) => r.startsWith("/usr/bin/env"))).toEqual([])
  })

  test("a drain that fails keeps the LaunchAgent plist, so the next uninstall tries again", async () => {
    const { host, home, omo } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    const failing: ColdWakeHost = {
      ...host,
      run: async (argv) =>
        argv.includes("stop") && argv[0] === "/usr/bin/env" ? { exitCode: 1, output: "busy\n" } : host.run(argv),
    }
    expect(await uninstallColdWake(failing, LAUNCH)).toEqual({ kind: "failed", step: "host_stop", detail: "busy" })
    expect(existsSync(LABEL_PLIST(home, "ai.omo.session-host"))).toBe(true)
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect([existsSync(LABEL_PLIST(home, "ai.omo.session-host")), omo.state.running]).toEqual([false, false])
  })

  test("uninstall unloads and removes the LaunchAgent, drains its pinned host and removes the entry", async () => {
    const { host, home, state, runs, omo } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect(existsSync(LABEL_PLIST(home, "ai.omo.session-host"))).toBe(false)
    expect(state.table).toBeUndefined()
    expect(omo.state.running).toBe(false)
    expect(runs.slice(0, 2)).toEqual(["launchctl bootout gui/501/ai.omo.session-host", `${OMO} status --json`])
    expect(runs[2]).toBe(`${OMO} stop --drain`)
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: false })
    expect(actions(runs).filter((r) => !r.includes("-extract"))).toEqual([])
  })
})
