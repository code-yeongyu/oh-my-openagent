import { describe, expect, it } from "vitest"
import { IMAGE, runPythonFacade, WINDOW_SNAPSHOT } from "./harness"

describe("Python computer facade", () => {
  it("sends display screenshot through the display-hopped chain", () => {
    // Given
    const responders = { display: JSON.stringify({ text: "", details: { value: { id: "active" } } }) }
    // When
    const run = runPythonFacade("computer.display('active').screenshot(silent=True)", responders)
    // Then
    expect(run.error).toBeNull()
    expect(run.calls).toEqual([
      { action: "call", chain: [{ method: "display", args: ["active"] }] },
      {
        action: "call",
        chain: [
          { method: "display", args: ["active"] },
          { method: "screenshot", args: [{ silent: true }] },
        ],
      },
    ])
  })

  it("turns keyword arguments into one trailing options object", () => {
    // When
    const run = runPythonFacade("win = computer.window(app='Code')\nwin.click(10, 20, button='right', delivery=None)")

    // Then
    expect(run.calls).toEqual([
      { action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
      {
        action: "call",
        chain: [
          { method: "window", args: ["w1"] },
          { method: "click", args: [10, 20, { button: "right" }] },
        ],
      },
    ])
  })

  it("drops trailing None positionals and sends no empty options object", () => {
    // When
    const run = runPythonFacade("computer.scroll(3, 4, None)")

    // Then
    expect(run.calls).toEqual([{ action: "call", chain: [{ method: "scroll", args: [3, 4] }] }])
  })

  it("sends raise_() as the raise method", () => {
    // When
    const run = runPythonFacade("computer.window(app='Code').raise_()")

    // Then
    expect(run.calls[1]).toEqual({
      action: "call",
      chain: [
        { method: "window", args: ["w1"] },
        { method: "raise", args: [] },
      ],
    })
  })

  it("returns details.value and displays every result image", () => {
    // When
    const run = runPythonFacade("out = computer.screenshot(silent=False)")

    // Then
    expect({ out: run.out, displayed: run.displayed }).toEqual({ out: { width: 1 }, displayed: [IMAGE] })
  })

  it("raises RuntimeError with the result text when the tool reports an error", () => {
    // When
    const run = runPythonFacade("computer.clipboard.write('secret')")

    // Then
    expect(run.error).toBe("RuntimeError: PermissionDenied: computer:exec is denied")
  })

  it("raises RuntimeError with the COMPUTER_PERMISSION_REQUIRED text when a permission denial comes back as an error", () => {
    // Given — the shape a code-mode marshal produces for the denial at omo #9475
    const text =
      "COMPUTER_PERMISSION_REQUIRED: screen recording is not granted. Do not retry until the user says the grant is done and the app was relaunched."
    const denial = JSON.stringify({
      text,
      details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" }, isError: true },
      hasError: true,
      images: [],
    })

    // When
    const run = runPythonFacade("computer.screenshot()", { screenshot: denial })

    // Then
    expect(run.error).toBe(`RuntimeError: ${text}`)
  })

  it("exposes the resolved window's identity fields on the handle", () => {
    // When
    const run = runPythonFacade(
      "w = computer.window(app='Code')\nout = {f: getattr(w, f) for f in ('id', 'app', 'title', 'pid', 'bounds', 'focused')}",
    )

    // Then
    expect(run.out).toEqual(WINDOW_SNAPSHOT)
  })

  it("returns an input helper's value with the engine's report, audit ids and tool call id", () => {
    // Given: the tool's details for a call that sent input
    const report = { disposition: { delivery: "not_delivered", retry: "safe" }, auditIds: ["audit-click"] }
    const details = { report, auditIds: ["audit-click"], toolCallId: "call-7" }
    const responders = { click: JSON.stringify({ text: "", details, images: [], hasError: false }) }

    // When
    const run = runPythonFacade("out = computer.click(1, 2)", responders)

    // Then
    expect({ error: run.error, out: run.out }).toEqual({
      error: null,
      out: { value: null, report, reports: [report], auditIds: ["audit-click"], toolCallId: "call-7" },
    })
  })

  it("forwards a win.menu.select delivery keyword as an options argument (#9888)", () => {
    // When
    const run = runPythonFacade(
      "win = computer.window(app='Code')\nwin.menu.select(['File', 'Save'], delivery='foreground')",
    )

    // Then
    expect(run.calls.at(-1)).toEqual({
      action: "call",
      chain: [
        { method: "window", args: ["w1"] },
        { method: "menu.select", args: [["File", "Save"], { delivery: "foreground" }] },
      ],
    })
  })

  it("sends menu.items and menu.select as window-hopped chains with the path forwarded", () => {
    // When
    const run = runPythonFacade(
      "win = computer.window(app='Code')\nwin.menu.items()\nwin.menu.items(['File'])\nwin.menu.select(['File', 'Export…', 'PDF'])",
    )

    // Then
    expect(run.calls).toEqual([
      { action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
      {
        action: "call",
        chain: [
          { method: "window", args: ["w1"] },
          { method: "menu.items", args: [] },
        ],
      },
      {
        action: "call",
        chain: [
          { method: "window", args: ["w1"] },
          { method: "menu.items", args: [["File"]] },
        ],
      },
      {
        action: "call",
        chain: [
          { method: "window", args: ["w1"] },
          { method: "menu.select", args: [["File", "Export…", "PDF"]] },
        ],
      },
    ])
  })

  it("sends el.type as a ref-hopped chain and returns how the text was delivered", () => {
    // When
    const run = runPythonFacade("el = computer.ref('e1')\nout = el.type('hello', delivery='foreground')", {
      type: JSON.stringify({ text: "", details: { value: { method: "inserted" } }, images: [], hasError: false }),
    })

    // Then
    expect(run.error).toBeNull()
    expect(run.out).toEqual({ method: "inserted" })
    expect(run.calls).toEqual([
      { action: "call", chain: [{ method: "ref", args: ["e1"] }] },
      {
        action: "call",
        chain: [
          { method: "ref", args: ["e1"] },
          { method: "type", args: ["hello", { delivery: "foreground" }] },
        ],
      },
    ])
  })

  it("sends control helpers as one-step call chains (#9651 B5b)", () => {
    // When
    const run = runPythonFacade(
      "computer.control.acquire(reason='click Run')\nout = computer.control.state()\ncomputer.control.release()",
    )

    // Then
    expect(run.calls).toEqual([
      { action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
      { action: "call", chain: [{ method: "control.state", args: [] }] },
      { action: "call", chain: [{ method: "control.release", args: [] }] },
    ])
  })
})
