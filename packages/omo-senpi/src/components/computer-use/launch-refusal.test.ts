import { expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { refusalChild, refusalRecord } from "../../../../senpi-desktop-engine/test/refusal-child"
import { fakeEngineFactory, rejectionOf } from "../../../../senpi-desktop-service/test/harness"
import { probeComputerUseEngine } from "./engine-probe"
import { TrackedDesktopService } from "./engine-status"
import { createComputerUseComponent } from "./index"

for (const reason of ["self-responsible", "unresolved"]) {
  test(`doctor reports actual ${reason} refusal`, async () => {
    const result = await probeComputerUseEngine("/fixture", {}, 5_000,
      () => refusalChild({ stderr: refusalRecord(reason) }))
    expect(result).toMatchObject({ ok: false, code: "launch-context-unavailable", reason })
  }, 10_000)
}

test("status stays passive, records failed restart, and emits no permission event", async () => {
  const live = fakeEngineFactory()
  const permissions: unknown[] = []
  let launches = 0
  const service = new TrackedDesktopService({
    createChild: () => ++launches === 1 ? live.spawn() : refusalChild(),
    onPermissionRequired: (permission) => permissions.push(permission),
  })
  expect(service.engineState).toBe("not started")
  expect(launches).toBe(0)
  await service.open({})
  expect(service.engineState).toBe("ready")
  const child = live.children[0]
  if (!child) throw new Error("missing child")
  const closed = once(child, "close")
  child.kill()
  await closed
  expect(await rejectionOf(service.capabilities())).toMatchObject({ code: "launch-context-unavailable" })
  expect(service.engineState).toBe("launch-context-unavailable")
  expect(launches).toBe(2)
  expect(permissions).toEqual([])
  await service.close()
}, 10_000)

test("initial tracked activation preserves the typed reason", async () => {
  const service = new TrackedDesktopService({ createChild: () => refusalChild() })
  expect(await rejectionOf(service.open({}))).toMatchObject({
    code: "launch-context-unavailable", reason: "self-responsible",
  })
  expect(service.engineState).toBe("launch-context-unavailable")
  await service.close()
}, 10_000)

test("the registered /computer on command reports recovery without a permission event or automatic retry", async () => {
  class Host extends FakeExtensionAPI {
    active = ["read"]
    rpc = { emit: (name: string, data: unknown) => { this.rpcEvents.push({ name, data }) } }
    getActiveTools() { return this.active }
    setActiveTools(names: string[]) { this.active = names }
    async executeTool() { throw new Error("no external action is allowed") }
  }
  const home = mkdtempSync(join(tmpdir(), "launch-command-"))
  const pi = new Host()
  let launches = 0
  const messages: { text: string; level: string }[] = []
  try {
    createComputerUseComponent({
      platform: "darwin", env: { HOME: home },
      engineChild: () => () => { launches++; return refusalChild() },
      loadSettings: () => resolveComputerSettings({ auditLog: { enabled: false } }, "darwin"),
    }).register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
    const handler = pi.commands.find((entry) => entry.name === "computer")?.options.handler
    if (typeof handler !== "function") throw new Error("missing registered command")
    const context = {
      cwd: home, model: undefined, hasUI: true,
      sessionManager: { getSessionId: () => "launch-command", getSessionDir: () => home },
      ui: { notify: (text: string, level: string) => messages.push({ text, level }) },
    }
    await pi.dispatch("session_start", {}, context)
    await handler("on", context)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.level).toBe("error")
    expect(messages[0]?.text).toContain("COMPUTER_LAUNCH_CONTEXT_REQUIRED")
    expect(launches).toBe(1)
    expect(pi.active).toEqual(["read"])
    expect(pi.rpcEvents).toEqual([])
  } finally {
    await pi.dispatch("session_shutdown", {}, {})
    rmSync(home, { recursive: true, force: true })
  }
}, 10_000)
