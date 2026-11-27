import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComputerHandle } from "../src/activation"
import { createComputerTool } from "../src/tool"
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }

afterEach(closeDesktops)

function toolFor(handle: ComputerHandle) {
  return createComputerTool({ handle, executeTool: () => Promise.reject(new Error("no tools")) })
}

describe("computer session metadata", HANG_GUARD, () => {
  it("gives an opaque computer identity that close ends and the next activation replaces", async () => {
    const { handle } = desktopFixture()
    const tool = toolFor(handle)
    const call = (action: "capabilities" | "close") =>
      tool.execute("call", { action }, undefined, undefined, hostContext())
    const first = await call("capabilities")
    const id = first.details.computerSession?.id
    expect(id).toEqual(expect.any(String))
    expect(id).not.toBe(hostContext().sessionManager.getSessionId())
    expect((await call("capabilities")).details.computerSession?.id).toBe(id)
    expect((await call("close")).details.computerSession).toMatchObject({
      id,
      lifecycle: "ended",
      picture: { kind: "withheld", reason: "unknown" },
    })
    const next = await call("capabilities")
    expect(next.details.computerSession?.id).toEqual(expect.any(String))
    expect(next.details.computerSession?.id).not.toBe(id)
    expect(JSON.stringify(first.content)).not.toContain(String(id))
    expect(JSON.stringify(first.details.value)).not.toContain(String(id))
  })

  it("keeps the computer identity when a settings change re-opens the engine session", async () => {
    const { handle, log } = desktopFixture({ showCursor: false })
    const tool = toolFor(handle)
    const capabilities = () => tool.execute("call", { action: "capabilities" }, undefined, undefined, hostContext())
    const id = (await capabilities()).details.computerSession?.id
    await handle.setShowCursor(true, hostContext())
    const after = await capabilities()
    expect({
      opens: methodsOf(log).filter((m) => m === "session.open").length,
      id: after.details.computerSession?.id,
    }).toEqual({ opens: 2, id: expect.any(String) })
    expect(after.details.computerSession?.id).toBe(id)
  })

  it.each([
    ["returns nothing", () => Promise.resolve(undefined), 0],
    ["throws", () => Promise.reject(new Error("viewer status transport failed")), 1],
  ] as const)("withholds the picture and keeps the result when viewer status %s", async (_case, status, reported) => {
    const { handle, service } = desktopFixture({}, { FAKE_ENGINE_PICTURE_STATE: "available" })
    vi.spyOn(service, "viewerStatus").mockImplementation(status)
    const reportError = vi.spyOn(service, "reportError")
    const result = await toolFor(handle).execute(
      "status",
      { action: "capabilities" },
      undefined,
      undefined,
      hostContext(),
    )
    expect({
      isError: result.isError,
      session: result.details.computerSession,
      reported: reportError.mock.calls.length,
    }).toMatchObject({
      isError: undefined,
      session: { lifecycle: "open", picture: { kind: "withheld", reason: "unknown" } },
      reported,
    })
  })

  it.each(["available", "secure_input", "locked", "permission_missing", "new-reason"])(
    "separates the viewer decision %s and the frame point from the model result",
    async (state) => {
      const { handle } = desktopFixture({}, { FAKE_ENGINE_PICTURE_STATE: state })
      const result = await toolFor(handle).execute(
        "pointer",
        {
          action: "run",
          code: "const w = await desktop.window({app:'Code'}); await w.screenshot({silent:true}); await w.click(3,4)",
        },
        undefined,
        undefined,
        hostContext(),
      )
      expect(result.details.computerSession).toMatchObject({
        lifecycle: "open",
        point: { action: "click", space: "frame", frameId: "101-1", target: "101", x: 3, y: 4 },
        picture:
          state === "available"
            ? { kind: "available" }
            : { kind: "withheld", reason: state === "new-reason" ? "unknown" : state },
      })
      expect(result.content).toEqual([{ type: "text", text: "Done." }])
    },
  )
})
