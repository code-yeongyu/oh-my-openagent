import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { ComputerRunError, type ComputerRunErrorReason } from "../src/run/context"
import { type ComputerRunSandbox, type ExecuteTool, runComputerCode } from "../src/run/runtime"
import { SANDBOX_OUTPUT_BYTES, SANDBOX_RETURN_BYTES } from "../src/run/sandbox/limits"
import { type QuickJsRunOptions, runQuickJsCode } from "../src/run/sandbox/quickjs"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory, rejectionOf } from "./harness"

// Every case waits on a real worker thread; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 60_000 }
const RUN_TIMEOUT_MS = 20_000
const CRASH_WORKER = fileURLToPath(new URL("./fixtures/quickjs-crash-worker.mjs", import.meta.url))

function snapshot(sessionId = "sandbox-session"): ComputerSessionSnapshot {
  return {
    cwd: "/work",
    sessionId,
    captureMaxWidth: 1280,
    captureMaxHeight: 800,
    captureMaxBytes: 5_000_000,
    display: "all",
    readOnly: false,
    stopHotkey: "ctrl+alt+shift+escape",
    allowHostRelayOnlyStop: false,
  }
}

interface FakeHost {
  readonly revokes: number[]
  readonly service: { revokeControl(): Promise<void>; reportError(error: unknown): void }
}

function fakeHost(): FakeHost {
  const revokes: number[] = []
  return {
    revokes,
    service: {
      revokeControl: async () => {
        revokes.push(revokes.length + 1)
      },
      reportError: (error: unknown) => {
        throw error
      },
    },
  }
}

interface CellOptions extends QuickJsRunOptions {
  readonly timeoutMs?: number
  readonly sessionId?: string
  readonly signal?: AbortSignal
  readonly host?: FakeHost
}

function cell(code: string, options: CellOptions = {}) {
  const { timeoutMs = RUN_TIMEOUT_MS, sessionId, signal, host = fakeHost(), ...runOptions } = options
  return runQuickJsCode(
    { code, snapshot: snapshot(sessionId), timeoutMs, ...(signal === undefined ? {} : { signal }) },
    host,
    runOptions,
  )
}

async function reasonOf(promise: Promise<unknown>): Promise<ComputerRunErrorReason> {
  const error = await rejectionOf(promise)
  if (!(error instanceof ComputerRunError)) throw error
  return error.reason
}

const services: DesktopService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
})

async function openDesktop(): Promise<DesktopService> {
  const service = new DesktopService({ createChild: fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" }).factory })
  services.push(service)
  await service.open({})
  return service
}

const noTools: ExecuteTool = (name) => Promise.reject(new Error(`unexpected tool ${name}`))

function dispatch(service: DesktopService, code: string, sandbox: ComputerRunSandbox, origin?: "host" | "model") {
  return runComputerCode(
    { code, snapshot: snapshot(), timeoutMs: RUN_TIMEOUT_MS, sandbox, ...(origin === undefined ? {} : { origin }) },
    { service, executeTool: noTools },
  )
}

const ESCAPES: readonly (readonly [string, string])[] = [
  ["require", `require("fs")`],
  ["process", `process.exit()`],
  ["fetch", `fetch("x")`],
  ["Bun", `Bun.file("x")`],
  ["tool", `tool.computer({})`],
  ["wait", `wait(1)`],
]

describe("QuickJS run cell", HANG_GUARD, () => {
  it.each(ESCAPES)("throws ReferenceError for %s and reports it undefined", async (name, use) => {
    // When
    const error = await rejectionOf(cell(`${use};`))
    const kind = await cell(`return typeof ${name};`)

    // Then
    expect(error).toBeInstanceOf(ReferenceError)
    expect(String((error as Error).message)).toContain(name)
    expect(kind.returnValue).toBe("undefined")
  })

  it("keeps the VM's own Function and leaves no host name on the global object", async () => {
    // When
    const result = await cell(`
			const names = Object.getOwnPropertyNames(globalThis);
			return {
				viaFunction: assert.constructor("return typeof process")(),
				host: ["process", "require", "Bun", "Deno", "fetch", "Buffer", "tool", "wait", "desktop", "computer", "setTimeout"].filter((name) => names.includes(name)),
			};
		`)

    // Then
    expect(result.returnValue).toEqual({ viaFunction: "undefined", host: [] })
  })

  it("rejects import() and has no WebAssembly, SharedArrayBuffer, Atomics or timers", async () => {
    // When
    const imported = await rejectionOf(cell(`await import("fs");`))
    const kinds = await cell(
      `return ["WebAssembly", "SharedArrayBuffer", "Atomics", "setTimeout", "setInterval"].map((name) => typeof globalThis[name]);`,
    )

    // Then
    expect(imported).toBeInstanceOf(Error)
    expect(kinds.returnValue).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined"])
  })

  it("returns a pure-JS body's value and its console output", async () => {
    // When
    const result = await cell(`console.log("sum", { a: 1 }); return 1 + 1;`)

    // Then
    expect(result.returnValue).toBe(2)
    expect(result.displays).toEqual([{ type: "text", text: 'sum {"a":1}' }])
    expect(result.screenshots).toEqual([])
  })

  it("maps a failed assert to ComputerRunError assertion and revokes the control grant", async () => {
    // Given
    const host = fakeHost()

    // When
    const error = await rejectionOf(cell(`assert(1 === 2, "nope");`, { host }))

    // Then
    expect(error).toBeInstanceOf(ComputerRunError)
    expect(error).toMatchObject({ reason: "assertion", message: "nope" })
    expect(host.revokes).toEqual([1])
  })

  it("rethrows a thrown error with its own name and a thrown primitive as itself", async () => {
    // When
    const typeError = await rejectionOf(cell(`null.x;`))
    const primitive = await rejectionOf(cell(`throw "plain";`))
    const syntax = await rejectionOf(cell(`return (;`))

    // Then
    expect(typeError).toBeInstanceOf(TypeError)
    expect(primitive).toBe("plain")
    expect(syntax).toBeInstanceOf(SyntaxError)
  })

  it.each([
    ["timeout", "while (true) {}", 1_000],
    ["memory", `const a = []; for (;;) a.push("x".repeat(1e6));`, RUN_TIMEOUT_MS],
    ["stack", "const f = () => f(); f();", RUN_TIMEOUT_MS],
  ] as const)("fails with %s and the next run in the session still works", async (reason, code, timeoutMs) => {
    // Given
    const host = fakeHost()

    // When
    const failed = await reasonOf(cell(code, { timeoutMs, host }))
    const next = await cell("return 40 + 2;")

    // Then
    expect(failed).toBe(reason)
    expect(host.revokes).toEqual([1])
    expect(next.returnValue).toBe(42)
  })

  it("ends a single long builtin with timeout by terminating the worker", async () => {
    // When
    const reason = await reasonOf(cell(`return /(a+)+$/.test("a".repeat(40) + "b");`, { timeoutMs: 500 }))
    const next = await cell("return 'alive';")

    // Then
    expect(reason).toBe("timeout")
    expect(next.returnValue).toBe("alive")
  })

  it("settles at once with crashed when the worker exits before the run settles", async () => {
    // Given
    const host = fakeHost()

    // When
    const error = await rejectionOf(cell("return 1;", { workerPath: CRASH_WORKER, host, timeoutMs: 600_000 }))
    const next = await cell("return 'fresh worker';")

    // Then
    expect(error).toBeInstanceOf(ComputerRunError)
    expect(error).toMatchObject({ reason: "crashed" })
    expect(String((error as Error).message)).toContain("code 3")
    expect(host.revokes).toEqual([1])
    expect(next.returnValue).toBe("fresh worker")
  })

  it("fails a body that awaits nothing the host can settle with stalled, long before its timeout", async () => {
    // When
    const reason = await reasonOf(cell("await new Promise(() => {});", { timeoutMs: 600_000 }))

    // Then
    expect(reason).toBe("stalled")
  })

  it("fails with aborted when the caller aborts", async () => {
    // Given
    const controller = new AbortController()

    // When
    const pending = cell("while (true) {}", { signal: controller.signal })
    controller.abort()

    // Then
    expect(await reasonOf(pending)).toBe("aborted")
  })

  it("cuts console output past its cap with a marker", async () => {
    // When
    const result = await cell(
      `const line = "y".repeat(64 * 1024); for (let i = 0; i < 20; i++) console.log(line); return "done";`,
    )

    // Then
    const texts = result.displays.map((display) => (display.type === "text" ? display.text : ""))
    const total = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0)
    expect(texts.at(-1)).toMatch(/\[output truncated: cap \d+ bytes\]$/)
    expect(total).toBeLessThan(SANDBOX_OUTPUT_BYTES + 100)
    expect(result.returnValue).toBe("done")
  })

  it("returns an over-cap value as a string ending in the truncation marker", async () => {
    // When
    const result = await cell(`return { big: "z".repeat(${SANDBOX_RETURN_BYTES + 10}) };`)

    // Then
    expect(typeof result.returnValue).toBe("string")
    const text = String(result.returnValue)
    expect(text.startsWith('{"big":"zzz')).toBe(true)
    expect(text).toMatch(/\[return value truncated: \d+ bytes, cap \d+ bytes\]$/)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SANDBOX_RETURN_BYTES)
  })

  it("serializes bridged calls, caps their count with calls, and refuses an over-cap argument list in the VM", async () => {
    // Given
    let inFlight = 0
    let maxInFlight = 0
    const bridge = {
      echo: async (args: readonly unknown[]) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight--
        return args[0]
      },
    }

    // When
    const parallel = await cell(`return await Promise.all([echo(1), echo(2), echo(3)]);`, { bridge })
    const refused = await cell(
      `try { await echo("w".repeat(2 * 1024 * 1024)); return "sent"; } catch (error) { return [error.name, error.reason]; }`,
      { bridge },
    )
    const flood = await reasonOf(cell(`for (;;) await echo(0);`, { bridge }))

    // Then
    expect(parallel.returnValue).toEqual([1, 2, 3])
    expect(maxInFlight).toBe(1)
    expect(refused.returnValue).toEqual(["ComputerRunError", "payloadSize"])
    expect(flood).toBe("calls")
  })

  it("refuses a non-JSON bridged argument with a TypeError inside the VM", async () => {
    // When
    const result = await cell(`try { await echo(() => 1); return "sent"; } catch (error) { return error.name; }`, {
      bridge: { echo: async () => undefined },
    })

    // Then
    expect(result.returnValue).toBe("TypeError")
  })

  it("runs one worker per session: a second run waits, and its timeout counts from submission", async () => {
    // Given
    let releaseFirst = () => {}
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted = () => {}
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const marks: string[] = []
    const bridge = {
      mark: async (args: readonly unknown[]) => {
        marks.push(String(args[0]))
        if (args[0] === "first") firstStarted()
      },
      hold: () => held,
    }

    // When
    const first = cell(`await mark("first"); await hold(); return "first done";`, { bridge, sessionId: "fifo" })
    await started
    const second = await reasonOf(
      cell(`await mark("second"); return 1;`, { bridge, sessionId: "fifo", timeoutMs: 1_000 }),
    )
    releaseFirst()
    const firstResult = await first
    const third = await cell(`await mark("third"); return 3;`, { bridge, sessionId: "fifo" })

    // Then
    expect(second).toBe("timeout")
    expect(firstResult.returnValue).toBe("first done")
    expect(third.returnValue).toBe(3)
    expect(marks).toEqual(["first", "third"])
  })
})

describe("runComputerCode sandbox dispatch", HANG_GUARD, () => {
  it("runs model code under quickjs and reports the sandbox", async () => {
    // Given
    const service = await openDesktop()

    // When
    const result = await dispatch(service, "return 1 + 1;", "quickjs", "model")

    // Then
    expect(result.returnValue).toBe(2)
    expect(result.sandbox).toBe("quickjs")
  })

  it("exposes tool under vm and not under quickjs (control)", async () => {
    // Given
    const service = await openDesktop()

    // When
    const vm = await dispatch(service, "return typeof tool;", "vm")
    const quickjs = await dispatch(service, "return typeof tool;", "quickjs")

    // Then
    expect({ vm: vm.returnValue, vmSandbox: vm.sandbox }).toEqual({ vm: "object", vmSandbox: "vm" })
    expect({ quickjs: quickjs.returnValue, quickjsSandbox: quickjs.sandbox }).toEqual({
      quickjs: "undefined",
      quickjsSandbox: "quickjs",
    })
  })

  it("keeps host-origin code on vm whatever the setting, while model wait() throws under quickjs", async () => {
    // Given
    const service = await openDesktop()

    // When
    const hostBatch = await dispatch(service, "await wait(1); return typeof tool;", "quickjs", "host")
    const modelWait = await rejectionOf(dispatch(service, "await wait(1);", "quickjs", "model"))

    // Then
    expect({ value: hostBatch.returnValue, sandbox: hostBatch.sandbox }).toEqual({ value: "object", sandbox: "vm" })
    expect(modelWait).toBeInstanceOf(ReferenceError)
  })

  it("defaults to vm when no sandbox is given", async () => {
    // Given
    const service = await openDesktop()

    // When
    const result = await runComputerCode(
      { code: "return typeof wait;", snapshot: snapshot(), timeoutMs: RUN_TIMEOUT_MS },
      { service, executeTool: noTools },
    )

    // Then
    expect({ value: result.returnValue, sandbox: result.sandbox }).toEqual({ value: "function", sandbox: "vm" })
  })
})
