import { afterEach, expect, test } from "bun:test"
import { type ComputerToolDeps, resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { fakeEngineFactory } from "../../../../senpi-desktop-service/test/harness"
import { createComputerUseRuntime, type ComputerUseRuntime } from "./runtime"

const runtimes: ComputerUseRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.handle.close()))
})

const context = {
  cwd: "/work",
  model: undefined,
  sessionManager: { getSessionId: () => "escape-test", getSessionDir: () => "/sessions/escape-test" },
}

function fixture(
  executeTool: ComputerToolDeps["executeTool"] = async () => ({ content: [] }),
  env: Record<string, string> = {},
) {
  const log = fakeEngineFactory({
    FAKE_ENGINE_DESKTOP: "1",
    FAKE_ENGINE_ESCAPE: "1",
    FAKE_ENGINE_BACKEND: "quartz",
    ...env,
  })
  const errors: string[] = []
  const runtime = createComputerUseRuntime({
    settings: resolveComputerSettings({ enabled: true, cuaAdapter: true }, "darwin"),
    executeTool,
    engineChild: () => log.factory,
    onEngineError: (code) => errors.push(code),
    fullAccess: () => true,
  })
  runtimes.push(runtime)
  return { runtime, log, errors }
}

test("native Escape notification refuses run, call, capabilities and CUA until delivered user input", async () => {
  const { runtime, log, errors } = fixture()
  await runtime.handle.activate(context)
  await runtime.service.grantForFullAccess(new AbortController().signal)
  expect(runtime.service.possiblyLive()).toBe(true)
  await runtime.service.call("windows", { fake: "escape" })
  expect(runtime.service.possiblyLive()).toBe(false)
  const before = log.requests.length
  for (const params of [
    { action: "run", code: "return await desktop.windows();" },
    { action: "call", chain: [{ method: "windows" }] },
    { action: "capabilities" },
  ]) {
    const result = await runtime.computerTool.execute("blocked", params, undefined, undefined, context)
    expect(result.isError).toBe(true)
  }
  const cua = await runtime.computerActionsTool.execute("blocked-cua", { action: "screenshot" }, undefined, undefined, context)
  expect(cua.isError).toBe(true)
  expect(log.requests.length).toBe(before)
  runtime.escapeStopGate.userInput({ inputId: "agent", attribution: "agent", source: "rpc" })
  runtime.escapeStopGate.inputStarted("agent")
  expect(await runtime.escapeStopGate.admit()).toBe(false)
  runtime.escapeStopGate.userInput({ inputId: "answer", attribution: "user", source: "extension" })
  expect(await runtime.escapeStopGate.admit()).toBe(false)
  runtime.escapeStopGate.inputStarted("answer")
  const next = await runtime.computerTool.execute("next-turn", { action: "run", code: "return await desktop.windows();" }, undefined, undefined, context)
  expect(next.isError).not.toBe(true)
  expect(errors).toEqual([])
}, 15_000)

test("a missed notification is caught by the native counter before tool admission", async () => {
  const { runtime } = fixture()
  await runtime.handle.activate(context)
  await runtime.service.call("windows", { fake: "escape-silent" })
  const result = await runtime.computerTool.execute("backstop", { action: "capabilities" }, undefined, undefined, context)
  expect(result.isError).toBe(true)
  expect(runtime.service.escapeStopCount()).toBe(1)
}, 15_000)

test("Escape aborts a running eval while its tool call is pending", async () => {
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<unknown>()
  const { runtime } = fixture(async (_name, _params, { signal }) => {
    signal.addEventListener("abort", () => pending.reject(signal.reason), { once: true })
    entered.resolve()
    return pending.promise
  })
  const running = runtime.computerTool.execute("in-flight", {
    action: "run", code: "return await tool.pending({});",
  }, undefined, undefined, context)
  await entered.promise
  await runtime.service.call("windows", { fake: "escape" })
  expect((await running).isError).toBe(true)
}, 15_000)

test("the failed-call counter backstop stops an eval even if its code catches the native error", async () => {
  const { runtime, log } = fixture(undefined, {
    FAKE_ENGINE_ESCAPE_ON: "typeText", FAKE_ENGINE_ESCAPE_SILENT: "1",
  })
  await runtime.handle.activate(context)
  await runtime.service.grantForFullAccess(new AbortController().signal)
  const result = await runtime.computerTool.execute("caught-native-error", {
    action: "run",
    code: "const w = await desktop.window('101'); try { await w.type('x', { deliveryMode: 'foreground' }); } catch {} return await desktop.windows();",
  }, undefined, undefined, context)
  expect(result.isError).toBe(true)
  const typed = log.requests.findIndex((request) => request.method === "typeText")
  expect(typed).toBeGreaterThanOrEqual(0)
  expect(log.requests.slice(typed + 1).some((request) => request.method === "windows")).toBe(false)
}, 15_000)
