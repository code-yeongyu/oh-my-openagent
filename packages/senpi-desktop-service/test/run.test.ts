import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComputerRunError } from "../src/run/context"
import { runComputerSteps, type StepProgram } from "../src/run/runtime"
import { DesktopEngineRpcError } from "../src/service/rpc-client"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }
// Only the runtime's and the service's timers are faked; child-process I/O keeps running on the real loop.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
}
const RUN_TIMEOUT_MS = 5_000

const services: DesktopService[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(services.splice(0).map((service) => service.close()))
})

async function openDesktop(
  env: Readonly<Record<string, string>> = {},
): Promise<{ service: DesktopService; log: SpawnLog }> {
  const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env })
  const service = new DesktopService({ createChild: log.factory })
  services.push(service)
  await service.open({})
  return { service, log }
}

interface RunOptions {
  readonly readOnly?: boolean
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

function snapshot(readOnly: boolean): ComputerSessionSnapshot {
  return {
    cwd: "/work",
    sessionId: "session-1",
    captureMaxWidth: 1280,
    captureMaxHeight: 800,
    captureMaxBytes: 5_000_000,
    display: "all",
    readOnly,
    stopHotkey: "ctrl+alt+shift+escape",
    allowHostRelayOnlyStop: false,
  }
}

function run(service: DesktopService, program: StepProgram, options: RunOptions = {}) {
  return runComputerSteps(
    {
      toolCallId: "tool-call-1",
      snapshot: snapshot(options.readOnly ?? false),
      timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    { service },
    program,
  )
}

function methods(log: SpawnLog): readonly string[] {
  return log.requests.map((request) => request.method)
}

describe("runComputerSteps", HANG_GUARD, () => {
  it("returns the program's value detached from the facade and displays the inline capture", async () => {
    // Given
    const { service } = await openDesktop()

    // When
    const result = await run(service, async ({ desktop }) => {
      const shot = await desktop.screenshot()
      const editor = await desktop.window({ app: "code" })
      return { width: shot.width, frameId: shot.frameId, window: editor.id, handle: editor }
    })

    // Then: a window handle comes back as its plain fields, never as a live facade object
    expect(result.returnValue).toMatchObject({
      width: 1280,
      frameId: "desktop-1",
      window: "101",
      handle: { id: "101" },
    })
    expect(Object.getPrototypeOf(Reflect.get(Object(result.returnValue), "handle"))).toBe(Object.prototype)
    expect(result.displays.map((display) => display.type)).toEqual(["text", "image"])
    expect(result.displays[1]).toEqual({ type: "image", data: expect.any(String), mimeType: "image/png" })
  })

  it("types into an element through ax.typeText and returns how the text was delivered", async () => {
    // Given
    const { service, log } = await openDesktop()

    // When
    const result = await run(service, async ({ desktop }) => {
      const el = await desktop.ref("e1")
      return [await el.type("hello"), await el.type("x", { delivery: "foreground" })]
    })

    // Then
    expect(result.returnValue).toEqual([{ method: "inserted" }, { method: "inserted" }])
    const typed = log.requests.filter((request) => request.method === "ax.typeText").map((request) => request.params)
    expect(typed).toEqual([
      { ref: "e1", text: "hello", opts: {} },
      { ref: "e1", text: "x", opts: { deliveryMode: "foreground" } },
    ])
  })

  it("shows an artifact-only capture as text with its path and records the artifact", async () => {
    // Given
    const { service } = await openDesktop()

    // When
    const result = await run(service, async ({ desktop }) => (await (await desktop.window("202")).screenshot()).path)

    // Then
    const path = "/tmp/fake-captures/202-1.png"
    expect(result.returnValue).toBe(path)
    expect(result.displays.every((display) => display.type === "text")).toBe(true)
    expect(result.displays.some((display) => display.type === "text" && display.text.includes(path))).toBe(true)
    expect(result.screenshots).toEqual([
      { path, width: 900, height: 700, sourceWidth: 900, sourceHeight: 700, target: "202" },
    ])
  })

  it("rejects click in a read-only run before it reaches the engine", async () => {
    // Given
    const { service, log } = await openDesktop()

    // When
    const error = await rejectionOf(run(service, ({ desktop }) => desktop.click(1, 1), { readOnly: true }))

    // Then
    expect(error).toBeInstanceOf(ComputerRunError)
    expect(error).toHaveProperty("reason", "readOnly")
    expect(error).toHaveProperty("message", "read-only call: 'click' sends input, which needs the exec tier")
    expect(methods(log)).not.toContain("click")
  })

  it("rejects menu.select in a read-only run before it reaches the engine", async () => {
    // Given
    const { service, log } = await openDesktop()
    const code: StepProgram = async ({ desktop }) => {
      const editor = await desktop.window({ app: "Code" })
      await editor.menu.select(["File", "Save"])
    }

    // When
    const error = await rejectionOf(run(service, code, { readOnly: true }))

    // Then
    expect(error).toBeInstanceOf(ComputerRunError)
    expect(error).toHaveProperty("reason", "readOnly")
    expect(error).toHaveProperty("message", "read-only call: 'menu.select' sends input, which needs the exec tier")
    expect(methods(log)).not.toContain("menus.select")
  })

  it("allows menu.items in a read-only run and returns the menu tree", async () => {
    // Given
    const { service, log } = await openDesktop()
    const code: StepProgram = async ({ desktop }) => {
      const editor = await desktop.window({ app: "Code" })
      return {
        root: (await editor.menu.items()).map((item) => item.title),
        file: (await editor.menu.items(["File"])).map((item) => item.title),
      }
    }

    // When
    const result = await run(service, code, { readOnly: true })

    // Then
    expect(result.returnValue).toEqual({ root: ["File", "Edit", "View"], file: ["Save", "Export…"] })
    expect(methods(log)).toContain("menus.items")
    expect(methods(log)).not.toContain("menus.select")
  })

  it("forwards the window id and the full menu path to the engine", async () => {
    // Given
    const { service, log } = await openDesktop()
    const code: StepProgram = async ({ desktop }) => {
      const editor = await desktop.window({ app: "Code" })
      await editor.menu.items(["File"])
      await editor.menu.select(["File", "Export…", "PDF"])
    }

    // When
    await run(service, code)

    // Then
    const items = log.requests.find((request) => request.method === "menus.items")
    expect(items?.params).toEqual({ windowId: "101", path: ["File"] })
    const select = log.requests.find((request) => request.method === "menus.select")
    expect(select?.params).toEqual({ windowId: "101", path: ["File", "Export…", "PDF"] })
  })

  it("forwards an explicit menu.select delivery as deliveryMode and omits it otherwise (#9888)", async () => {
    // Given
    const { service, log } = await openDesktop()
    const code: StepProgram = async ({ desktop }) => {
      const editor = await desktop.window({ app: "Code" })
      await editor.menu.select(["File", "Save"])
      await editor.menu.select(["File", "Save"], { delivery: "foreground" })
    }

    // When
    await run(service, code)

    // Then
    const selects = log.requests.filter((request) => request.method === "menus.select").map((request) => request.params)
    expect(selects[0]).toEqual({ windowId: "101", path: ["File", "Save"] })
    expect(selects[1]).toEqual({ windowId: "101", path: ["File", "Save"], deliveryMode: "foreground" })
  })

  it("allows screenshot in a read-only run", async () => {
    // Given
    const { service, log } = await openDesktop()

    // When
    const result = await run(service, async ({ desktop }) => (await desktop.screenshot({ silent: true })).frameId, {
      readOnly: true,
    })

    // Then
    expect(result.returnValue).toBe("desktop-1")
    expect(methods(log)).toContain("capture")
  })

  it("surfaces the engine's InvalidCoordinateFrame when input precedes the target's first capture", async () => {
    // Given
    const { service } = await openDesktop()

    // When
    const error = await rejectionOf(run(service, ({ desktop }) => desktop.click(5, 5)))

    // Then
    expect(error).toBeInstanceOf(DesktopEngineRpcError)
    expect(error).toHaveProperty("rpcCode", -32007)
    expect(error).toHaveProperty("data.code", "InvalidCoordinateFrame")
  })

  it("drives a window handle by its id and reports the engine's audit events tagged with the tool call", async () => {
    // Given
    const { service, log } = await openDesktop()
    const code: StepProgram = async ({ desktop }) => {
      const editor = await desktop.window({ app: "Code" })
      await editor.screenshot({ silent: true })
      await editor.click(3, 4, { delivery: "foreground" })
    }

    // When
    const result = await run(service, code)

    // Then
    const click = log.requests.find((request) => request.method === "click")
    expect(click?.params).toEqual({ target: "101", x: 3, y: 4, opts: { deliveryMode: "foreground" } })
    expect(result.audit).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        toolCallId: "tool-call-1",
        action: "click",
        target: "101",
        status: "success",
      }),
    ])
  })

  it("rejects an aborted run and sends $/cancel for its in-flight engine call", async () => {
    // Given
    const { service, log } = await openDesktop({ FAKE_ENGINE_STALL: "windows" })
    const abort = new AbortController()
    const running = rejectionOf(run(service, ({ desktop }) => desktop.windows(), { signal: abort.signal }))
    const sent = await log.nthRequest("windows", 1)

    // When
    abort.abort()
    const error = await running

    // Then
    expect(error).toHaveProperty("reason", "aborted")
    expect((await log.nthRequest("$/cancel", 1)).params).toEqual({ id: sent.id })
  })

  it("times out a program that keeps calling at timeoutMs and cancels its in-flight engine call", async () => {
    // Given
    vi.useFakeTimers(TIMERS)
    const { service, log } = await openDesktop({ FAKE_ENGINE_STALL: "windows" })
    let settled = false
    const running = rejectionOf(
      run(service, async ({ desktop }) => {
        for (;;) {
          await desktop.displays()
          await desktop.windows()
        }
      }).finally(() => {
        settled = true
      }),
    )
    const sent = await log.nthRequest("windows", 1)

    // When
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS)

    // Then: settled at timeoutMs, before the service's cancel grace could have elapsed
    expect(settled).toBe(true)
    expect(await running).toHaveProperty("reason", "timeout")
    expect((await log.nthRequest("$/cancel", 1)).params).toEqual({ id: sent.id })
  })
})
