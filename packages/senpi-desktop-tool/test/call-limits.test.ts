import { afterEach, describe, expect, it, vi } from "vitest"
import { runComputerCommand } from "../src/command"
import { createComputerActionsTool } from "../src/cua-adapter"
import { MAX_ARGUMENT_BYTES, MAX_RESULT_BYTES } from "../src/payload-caps"
import { createComputerTool } from "../src/tool"
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }

afterEach(closeDesktops)

describe("limits at the computer tool boundary", HANG_GUARD, () => {
  it("refuses computer arguments over the byte cap before any engine starts", async () => {
    // Given: one byte of text past the cap
    const { handle, log } = desktopFixture()
    const text = "x".repeat(MAX_ARGUMENT_BYTES)
    const params = { action: "call", chain: [{ method: "clipboard.write", args: [text] }] }

    // When
    const result = await createComputerTool({ handle }).execute("call-big", params, undefined, undefined, hostContext())

    // Then
    expect(result).toMatchObject({ isError: true, details: { value: { code: "COMPUTER_ARGUMENTS_TOO_LARGE" } } })
    expect(log.children).toHaveLength(0)
  })

  it("refuses computer_actions arguments over the byte cap before any engine starts", async () => {
    // Given
    const { handle, log } = desktopFixture()
    const params = { action: "type", text: "x".repeat(MAX_ARGUMENT_BYTES) }

    // When
    const result = await createComputerActionsTool({ handle }).execute(
      "call-big",
      params,
      undefined,
      undefined,
      hostContext(),
    )

    // Then
    expect(result).toMatchObject({ isError: true, details: { value: { code: "COMPUTER_ARGUMENTS_TOO_LARGE" } } })
    expect(log.children).toHaveLength(0)
  })

  it("replaces a helper value over the byte cap with a failure that keeps the call's tool call id", async () => {
    // Given: a clipboard holding more text than a reply may carry
    const { handle, service } = desktopFixture({ auditLog: { enabled: false } })
    const call = service.call.bind(service)
    vi.spyOn(service, "call").mockImplementation((method, ...rest) =>
      method === "clipboard.read" ? Promise.resolve({ text: "x".repeat(MAX_RESULT_BYTES) }) : call(method, ...rest),
    )

    // When
    const result = await createComputerTool({ handle }).execute(
      "call-read",
      { action: "call", chain: [{ method: "clipboard.read" }] },
      undefined,
      undefined,
      hostContext(),
    )

    // Then
    expect(result).toMatchObject({
      isError: true,
      details: { isError: true, toolCallId: "call-read", value: { code: "COMPUTER_RESULT_TOO_LARGE" } },
    })
    expect(JSON.stringify(result).length).toBeLessThan(MAX_RESULT_BYTES)
  })

  it("answers a call past the session's call budget with a structured refusal and sends nothing", async () => {
    // Given: a session whose one allowed request went to the capabilities query
    const { handle, log } = desktopFixture({}, {}, 1)
    const tool = createComputerTool({ handle })
    await tool.execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext())

    // When
    const result = await tool.execute(
      "call-2",
      { action: "call", chain: [{ method: "windows" }] },
      undefined,
      undefined,
      hostContext(),
    )

    // Then
    expect(result).toMatchObject({ isError: true, details: { value: { code: "COMPUTER_CALL_BUDGET_EXCEEDED" } } })
    expect(methodsOf(log)).not.toContain("windows")
  })

  it("reports a batch step past the call budget as that step's budget failure", async () => {
    // Given
    const { handle, log } = desktopFixture({}, {}, 0)

    // When
    const result = await createComputerActionsTool({ handle }).execute(
      "call-batch",
      { action: "screenshot" },
      undefined,
      undefined,
      hostContext(),
    )

    // Then
    expect(result).toMatchObject({
      isError: true,
      details: { value: { failedIndex: 0, failure: { code: "COMPUTER_CALL_BUDGET_EXCEEDED" } } },
    })
    expect(methodsOf(log)).not.toContain("capture")
  })

  it("keeps the budget spent across the model's close, and only the user's /computer off restores it", async () => {
    // Given: a spent budget
    const { handle } = desktopFixture({}, {}, 1)
    const tool = createComputerTool({ handle })
    const windows = { action: "call", chain: [{ method: "windows" }] }
    await tool.execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext())
    const refused = await tool.execute("call-2", windows, undefined, undefined, hostContext())

    // When
    await tool.execute("call-close", { action: "close" }, undefined, undefined, hostContext())
    const afterClose = await tool.execute("call-3a", windows, undefined, undefined, hostContext())
    await runComputerCommand("off", handle, hostContext())
    await runComputerCommand("on", handle, hostContext())
    const after = await tool.execute("call-3", windows, undefined, undefined, hostContext())

    // Then
    expect(refused.details.value).toMatchObject({
      code: "COMPUTER_CALL_BUDGET_EXCEEDED",
      message: expect.stringContaining("/computer off"),
    })
    expect(refused.details.value).not.toMatchObject({ message: expect.stringContaining("computer.close") })
    expect(afterClose.details.value).toMatchObject({ code: "COMPUTER_CALL_BUDGET_EXCEEDED" })
    expect(after.isError).not.toBe(true)
  })
})
