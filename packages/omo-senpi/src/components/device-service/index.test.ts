import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { StartupWork } from "../../extension/startup-deferral"
import { createDeviceServiceComponent, type DeviceServiceComponentOptions } from "./index"
import type { BootstrapReport } from "./runner"

const OMO_BIN = "/opt/omo/bin/omo"
const SIGNED_IN_ENV = { OMO_BIN }

type Notice = { readonly message: string; readonly type: string | undefined }

function harness(
  options: Partial<DeviceServiceComponentOptions> & { readonly hasUI?: boolean; readonly mode?: string } = {},
) {
  const pi = new FakeExtensionAPI()
  const deferred: StartupWork[] = []
  const warnings: string[] = []
  const notices: Notice[] = []
  const runs: string[] = []
  const ctx: ComponentContext = {
    logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
    config: { getFlag: () => undefined },
    deferStartupWork: (_label, work) => deferred.push(work),
  }
  const eventCtx = {
    cwd: "/work/project",
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? "tui",
    ui: { notify: (message: string, type?: string) => notices.push({ message, type }) },
  }
  const component = createDeviceServiceComponent({
    env: SIGNED_IN_ENV,
    latch: { claimed: false },
    loadConfig: () => ({ config: {} }),
    run: async (omoBin) => {
      runs.push(omoBin)
      return { state: "connected" }
    },
    ...options,
  })
  const start = () =>
    pi.handlers
      .filter(({ event }) => event === "session_start")
      .map(({ handler }) => handler({ reason: "startup" }, eventCtx))
  const flush = async () => {
    for (const work of deferred.splice(0)) await work()
  }
  return { pi, ctx, component, deferred, warnings, notices, runs, start, flush }
}

describe("device-service start-up bootstrap", () => {
  test("signed-in omo start runs the bootstrap once, in the background after first paint", async () => {
    const latch = { claimed: false }
    const h = harness({ latch })
    h.component.register(h.pi, h.ctx)
    expect(h.start()).toEqual([undefined])
    expect(h.runs).toEqual([])
    await h.flush()
    expect(h.runs).toEqual([OMO_BIN])

    h.start()
    await h.flush()
    const again = harness({ latch })
    again.component.register(again.pi, again.ctx)
    again.start()
    await again.flush()
    expect([...h.runs, ...again.runs]).toEqual([OMO_BIN])
  })

  test("a bootstrap that never settles never holds a later session start, which starts no second worker", async () => {
    const started: string[] = []
    const h = harness({
      run: (omoBin) => {
        started.push(omoBin)
        return new Promise<BootstrapReport | undefined>(() => {})
      },
    })
    h.component.register(h.pi, h.ctx)
    h.start()
    void h.deferred[0]?.()
    expect(h.start()).toEqual([undefined])
    await h.deferred[1]?.()
    expect(started).toEqual([OMO_BIN])
  })

  test("device_service.enabled false runs nothing: no install, no connect", async () => {
    const h = harness({ loadConfig: () => ({ config: { device_service: { enabled: false } } }) })
    h.component.register(h.pi, h.ctx)
    h.start()
    await h.flush()
    expect(h.runs).toEqual([])
  })

  // Only the top-level interactive TUI bootstraps. senpi's RPC mode binds a real UI context (hasUI is true there), and
  // every task child (team members included) inherits OMO_BIN, so neither hasUI nor OMO_BIN alone identifies it.
  test.each([
    ["not an omo launch (no OMO_BIN)", {}, true, "tui"],
    ["a relative OMO_BIN", { OMO_BIN: "omo" }, true, "tui"],
    ["CI", { OMO_BIN, CI: "true" }, true, "tui"],
    ["a session without a UI", { OMO_BIN }, false, "tui"],
    ["an RPC host or RPC task child with a bound UI context", { OMO_BIN }, true, "rpc"],
    ["a JSON run", { OMO_BIN }, true, "json"],
    ["a print run", { OMO_BIN }, false, "print"],
    ["a task child that runs a TUI", { OMO_BIN, OMO_SENPI_TASK_RPC_CHILD: "1" }, true, "tui"],
  ])("%s runs nothing", async (_label, env, hasUI, mode) => {
    const h = harness({ env, hasUI, mode })
    h.component.register(h.pi, h.ctx)
    h.start()
    await h.flush()
    expect(h.runs).toEqual([])
  })

  test.each<[string, BootstrapReport | undefined, Notice[], number]>([
    [
      "a locked keychain",
      { state: "keychain_locked", notice: "Unlock it." },
      [{ message: "Unlock it.", type: "warning" }],
      0,
    ],
    [
      "an install this build refuses",
      { state: "update_required", notice: "Update OmO." },
      [{ message: "Update OmO.", type: "warning" }],
      0,
    ],
    ["a signed-out device", { state: "signed_out", notice: "Sign in to OmO first." }, [], 0],
    [
      "no credential store to read a sign-in from",
      { state: "store_unavailable", notice: "The credential store is not available." },
      [],
      0,
    ],
    ["a connected device", { state: "connected" }, [], 0],
    ["a worker that answered nothing usable", undefined, [], 1],
  ])("%s ends with the notices the user can act on", async (_label, report, notices, warnings) => {
    const h = harness({ run: async () => report })
    h.component.register(h.pi, h.ctx)
    h.start()
    await h.flush()
    expect(h.notices).toEqual(notices)
    expect(h.warnings).toHaveLength(warnings)
  })
})
