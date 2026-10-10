import { expect, spyOn, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { computerUseDoctorReport } from "../../../../omo-native/computer-use-doctor-runtime"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createComputerUseComponent } from "./index"

class Host extends FakeExtensionAPI {
  active = ["read"]
  getActiveTools() { return [...this.active] }
  setActiveTools(names: string[]) { this.active = names }
  async executeTool() { return { content: [] } }
}

// A POSIX executable script exercises the default native spawn path, not a mocked permission report.
for (const state of ["ready", "abi-mismatch"]) {
test.if(process.platform !== "win32")(`status passively probes permissions and retains source before activation and when ${state}`, async () => {
  const root = mkdtempSync(join(tmpdir(), "cu-passive-"))
  const script = join(root, "engine.mjs")
  const engine = join(root, "engine")
  const log = join(root, "requests.jsonl")
  const fake = resolve(import.meta.dir, "../../../../senpi-desktop-service/test/fake-engine.mjs")
  writeFileSync(script, `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const capabilities = { backend: "fake", capture: false, input: false, ax: false,
 backgroundWindowInput: false, deliveryModes: [], capturePermission: "denied",
 inputPermission: "denied", axPermission: "denied", displayCount: 0,
 focusGuard: true, stopPath: "none", screenLocked: false };
createInterface({ input: process.stdin }).on("line", line => {
 const req = JSON.parse(line);
 appendFileSync(${JSON.stringify(log)}, req.method + "\\n");
 const result = req.method === "engine.hello"
  ? { protocolVersion: "1", engineVersion: "test", buildSha: "test", abi: "senpi-desktop/1" }
  : req.method === "capabilities" ? capabilities : undefined;
 process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id,
  ...(result === undefined ? { error: { code: -32601, message: "forbidden method" } } : { result }) }) + "\\n");
});
`)
  writeFileSync(engine, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`)
  chmodSync(engine, 0o755)
  mkdirSync(join(root, ".omo"))
  writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({
    "[native]": { computer: { enabled: true, engine_path: engine } },
  }))
  const pi = new Host()
  let starts = 0
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    () => { throw new Error("status must not fetch") }, { preconnect: globalThis.fetch.preconnect },
  ))
  const messages: string[] = []
  try {
    createComputerUseComponent({
      platform: process.platform, env: { HOME: root },
      loadSettings: () => resolveComputerSettings({ enginePath: engine }, process.platform),
      engineChild: () => () => {
        starts += 1
        return spawn(process.execPath, [fake, "--stdio"], {
          stdio: "pipe", env: {
            ...process.env, FAKE_ENGINE_DESKTOP: "1",
            FAKE_ENGINE_ABI: state === "ready" ? "senpi-desktop/1" : "other/9",
          },
        })
      },
    }).register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
    const registration = pi.commands.find(item => item.name === "computer")
    if (!registration) throw new Error("computer command missing")
    const handler = registration.options.handler as (args: string, ctx: unknown) => Promise<void>
    const ctx = {
      cwd: root, model: undefined, hasUI: true,
      sessionManager: { getSessionId: () => "passive", getSessionDir: () => root },
      ui: { notify: (text: string) => messages.push(text) },
    }
    await handler("status", ctx)
    expect(starts).toBe(0)
    expect(pi.active).toEqual(["read"])
    expect(messages.at(-1)).toContain(`found ${engine} (explicit)`)
    expect(messages.at(-1)).toContain("capturePermission=denied inputPermission=denied axPermission=denied")
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["engine.hello", "capabilities"])
    const report = await computerUseDoctorReport({
      cwd: root, env: { HOME: root, OMO_PACKAGE_DIR: root }, version: "5.1.7",
      packageRoot: root,
    })
    expect(report.kind).toBe("ready")
    if (report.kind !== "ready") throw new Error("expected passive doctor report")
    expect(messages.at(-1)).toContain(`found ${report.enginePath} (${report.engineSource})`)
    expect(messages.at(-1)).toContain(`capturePermission=${report.capabilities.capturePermission}`)
    expect(messages.at(-1)).toContain(`inputPermission=${report.capabilities.inputPermission}`)
    expect(messages.at(-1)).toContain(`axPermission=${report.capabilities.axPermission}`)
    await handler("on", ctx)
    expect(starts).toBe(1)
    await handler("status", ctx)
    expect(messages.at(-1)).toContain(`engine: ${state}`)
    expect(messages.at(-1)).toContain(`engine source: found ${engine} (explicit)`)
    expect(readFileSync(log, "utf8").trim().split("\n"))
      .toEqual(Array.from({ length: state === "ready" ? 2 : 3 }, () => ["engine.hello", "capabilities"]).flat())
    await handler("off", ctx)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    await pi.dispatch("session_shutdown", {}, {})
    fetch.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
}
