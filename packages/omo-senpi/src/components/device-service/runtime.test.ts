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
