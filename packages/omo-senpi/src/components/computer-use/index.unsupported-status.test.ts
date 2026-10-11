import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { defaultEngineChild, describeEngineSource } from "./engine-source"
import { createComputerUseComponent } from "./index"
import { createComputerUseRuntime } from "./runtime"
import { describeEnginePermissions } from "./permission-status"

class Host extends FakeExtensionAPI {
  getActiveTools() { return ["read"] }
  setActiveTools() {}
  async executeTool() { return { content: [] } }
}

test.each(["linux", "win32"])("status preserves %s-arm64 absence after failed first use without acquisition", async (platform) => {
  const root = mkdtempSync(join(tmpdir(), "cu-unsupported-"))
  const pi = new Host()
  const locator = { platform, arch: "arm64", execDir: root, repoRoot: root, packageDir: root, runtimeDir: "" }
  let starts = 0
  const messages: string[] = []
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => {
    throw new Error("status must not download")
  }, { preconnect: globalThis.fetch.preconnect }))
  try {
    createComputerUseComponent({
      platform,
      env: {},
      loadSettings: () => resolveComputerSettings({}, platform),
      engineChild: () => () => {
        starts += 1
        return defaultEngineChild({}, locator)(undefined)()
      },
      loadRuntime: async () => ({
        createComputerUseRuntime: (options) => ({
          ...createComputerUseRuntime(options),
          describeEngineSource: () => describeEngineSource(undefined, {}, locator),
          describeEnginePermissions: () => describeEnginePermissions(undefined, {}, locator),
        }),
      }),
    }).register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
    const registration = pi.commands.find((item) => item.name === "computer")
    if (!registration) throw new Error("computer command missing")
    const ctx = {
      cwd: root, model: undefined, hasUI: true,
      sessionManager: { getSessionId: () => "unsupported", getSessionDir: () => root },
      ui: { notify: (text: string) => messages.push(text) },
    }
    const handler = registration.options.handler as (args: string, ctx: unknown) => Promise<void>
    await handler("status", ctx)
    expect(starts).toBe(0)
    await handler("on", ctx)
    expect(starts).toBe(1)
    expect(messages.at(-1)).toContain("native-unavailable")
    await handler("status", ctx)
    expect(messages.at(-1)).toContain(`No senpi-desktop-engine is built for ${platform}-arm64`)
    expect(messages.at(-1)).toContain("engine: native-unavailable")
    expect(starts).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
