import { afterEach, describe, expect, test } from "bun:test"

import type { BootstrapReport } from "./runner"

const LATCH_KEY = Symbol.for("omo.device-service.bootstrap")

afterEach(() => {
  Reflect.deleteProperty(globalThis, LATCH_KEY)
})

// A query suffix on the relative specifier makes the runtime load as a separate module instance, as a second copy of the
// sidecar would.
const loadInstance = (tag: string): Promise<typeof import("./runtime")> => import(`./runtime.ts?${tag}`)

describe("the device service bootstrap process latch", () => {
  test("a second instance of the sidecar module in the same process does not bootstrap again", async () => {
    const first = await loadInstance("first")
    const second = await loadInstance("second")
    expect(second).not.toBe(first)
    const runs: string[] = []
    const options = {
      env: { OMO_BIN: "/opt/omo/launcher" },
      loadConfig: () => ({ config: {} }),
      run: async (omoBin: string): Promise<BootstrapReport | undefined> => {
        runs.push(omoBin)
        return { state: "connected" }
      },
    }
    const eventCtx = { mode: "tui", hasUI: true, cwd: "/work/project", ui: { notify: () => {} } }
    const logger = { info() {}, warn() {}, error() {} }
    await first.bootstrapAtStart(eventCtx, logger, options)
    await second.bootstrapAtStart(eventCtx, logger, options)
    expect(runs).toEqual(["/opt/omo/launcher"])
  })
})

// #12656: a release that was never published is not the user's to act on at start-up; a download failure still is.
describe("the start-up notice of a stopped bootstrap", () => {
  const startWith = async (report: BootstrapReport) => {
    const { bootstrapAtStart } = await loadInstance(`notice-${report.state}`)
    const notices: [string, string | undefined][] = []
    const debug: unknown[][] = []
    const eventCtx = {
      mode: "tui",
      hasUI: true,
      cwd: "/work/project",
      ui: { notify: (message: string, type?: string) => notices.push([message, type]) },
    }
    const logger = { info() {}, warn() {}, error() {}, debug: (...args: unknown[]) => debug.push(args) }
    await bootstrapAtStart(eventCtx, logger, {
      env: { OMO_BIN: "/opt/omo/launcher" },
      latch: { claimed: false },
      loadConfig: () => ({ config: {} }),
      run: async () => report,
    })
    return { notices, debug }
  }

  test("not_published shows no warning and leaves one debug line", async () => {
    const notice =
      "Remote devices are not available in this omo build yet: OmO device service 0.1.0 has not been published."
    const { notices, debug } = await startWith({ state: "not_published", notice })
    expect(notices).toEqual([])
    expect(debug).toEqual([["device service release is not published", { notice }]])
  })

  test("a download failure still warns", async () => {
    const notice = "Could not download the OmO device service. Check the connection and try again."
    const { notices } = await startWith({ state: "service_degraded", notice })
    expect(notices).toEqual([[notice, "warning"]])
  })
})
