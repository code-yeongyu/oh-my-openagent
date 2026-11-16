import { describe, expect, it } from "vitest"
import { ELEMENT_SNAPSHOT, IMAGE, loadJsFacade, WINDOW_SNAPSHOT, windowResponder } from "./harness"

describe("JavaScript computer facade", () => {
  it("sends display input as a display-hopped chain with its selector preserved", async () => {
    // Given
    const kernel = loadJsFacade(() => ({ text: "", details: { value: { id: "all" } } }))
    // When
    await kernel.run(`await (await computer.display("all")).click(20, 10);`)
    // Then
    expect(kernel.calls).toEqual([
      { action: "call", chain: [{ method: "display", args: ["all"] }] },
      {
        action: "call",
        chain: [
          { method: "display", args: ["all"] },
          { method: "click", args: [20, 10] },
        ],
      },
    ])
  })

  it("sends a window click as one two-step call chain through tool.computer", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    await kernel.run(
      `const win = await computer.window({ app: "Code" }); await win.click(1, 2, { delivery: "foreground" });`,
    )

    // Then
    expect(kernel.calls).toEqual([
      { action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
      {
        action: "call",
        chain: [
          { method: "window", args: ["w1"] },
          { method: "click", args: [1, 2, { delivery: "foreground" }] },
        ],
      },
    ])
  })

  it("exposes the resolved window's identity fields on the handle", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    const serialized = await kernel.run(`return JSON.stringify(await computer.window({ app: "Code" }));`)

    // Then
    expect(JSON.parse(String(serialized))).toEqual(WINDOW_SNAPSHOT)
  })

  it("returns details.value and displays every result image", async () => {
    // Given
    const kernel = loadJsFacade(() => ({
      text: "screenshot desktop 1x1",
      details: { value: { width: 1 } },
      images: [IMAGE],
    }))

    // When
    const value = await kernel.run("return await computer.screenshot();")

    // Then
    expect({ value, displayed: kernel.displayed }).toEqual({ value: { width: 1 }, displayed: [IMAGE] })
  })

  it("throws the result text when the tool reports an error", async () => {
    // Given
    const kernel = loadJsFacade(() => ({ text: "Suspended: the user pressed the stop chord", hasError: true }))

    // When
    const call = kernel.run("await computer.click(5, 5);")

    // Then
    await expect(call).rejects.toThrow("Suspended: the user pressed the stop chord")
  })

  it("throws the COMPUTER_PERMISSION_REQUIRED text when a permission denial comes back as an error", async () => {
    // Given — the shape a code-mode marshal produces for the denial at omo #9475
    const text =
      "COMPUTER_PERMISSION_REQUIRED: accessibility permission is missing. Do not retry until the user says the grant is done and the app was relaunched."
    const kernel = loadJsFacade(() => ({
      text,
      details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" }, isError: true },
      hasError: true,
    }))

    // When
    const call = kernel.run("await computer.screenshot();")

    // Then
    await expect(call).rejects.toThrow("COMPUTER_PERMISSION_REQUIRED")
  })

  it("drops trailing undefined arguments from a chain step", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    await kernel.run("await computer.scroll(3, 4, undefined);")

    // Then
    expect(kernel.calls).toEqual([{ action: "call", chain: [{ method: "scroll", args: [3, 4] }] }])
  })

  it("rejects a function argument to a direct helper before calling the tool", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    const call = kernel.run("await computer.windows(() => true);")

    // Then
    await expect(call).rejects.toThrow(TypeError)
    expect(kernel.calls).toEqual([])
  })

  it("never sends a three-step chain: a window handle has no window() to chain", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    const call = kernel.run(`const win = await computer.window({ app: "Code" }); await win.window({ app: "Code" });`)

    // Then
    await expect(call).rejects.toThrow(TypeError)
    expect(kernel.calls).toEqual([{ action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] }])
  })

  it("resolves an input helper to its value with the engine's report, audit ids and tool call id", async () => {
    // Given: the tool's details for a call that sent input
    const report = {
      disposition: { delivery: "delivered_unverified", retry: "unsafe" },
      delivered: null,
      effect: "unverifiable",
      route: null,
      hit: null,
      focusRestoration: "not_needed",
      openedSurfaces: [],
      nextCall: null,
      note: null,
      warning: null,
      auditIds: ["audit-click"],
      timings: null,
      legacy: false,
    }
    const kernel = loadJsFacade(() => ({
      text: "",
      details: { report, auditIds: ["audit-click"], toolCallId: "call-7" },
    }))

    // When
    const result = await kernel.run("return await computer.click(1, 2);")

    // Then
    expect(result).toEqual({
      value: undefined,
      report,
      reports: [report],
      auditIds: ["audit-click"],
      toolCallId: "call-7",
    })
  })

  it("keeps every report of a call in send order and leaves a read helper's value as is", async () => {
    // Given
    const first = { disposition: { delivery: "delivered_verified", retry: "unsafe" }, auditIds: ["a1"] }
    const last = { disposition: { delivery: "not_delivered", retry: "safe" }, auditIds: ["a2"] }
    const kernel = loadJsFacade((args) =>
      args.action === "call" && JSON.stringify(args.chain).includes("windows")
        ? { text: "", details: { value: [WINDOW_SNAPSHOT] } }
        : { text: "", details: { report: last, reports: [first, last], auditIds: ["a1", "a2"], toolCallId: "call-8" } },
    )

    // When
    const typed = await kernel.run('return await computer.type("hi");')
    const windows = await kernel.run("return await computer.windows();")

    // Then
    expect({ typed, windows }).toEqual({
      typed: { value: undefined, report: last, reports: [first, last], auditIds: ["a1", "a2"], toolCallId: "call-8" },
      windows: [WINDOW_SNAPSHOT],
    })
  })

  it("maps capabilities() and close() to their own tool actions", async () => {
    // Given
    const kernel = loadJsFacade(() => ({ text: "" }))

    // When
    await kernel.run("await computer.capabilities(); await computer.close();")

    // Then
    expect(kernel.calls).toEqual([{ action: "capabilities" }, { action: "close" }])
  })

  it("sends menu.items and menu.select as window-hopped chains with the path forwarded", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    await kernel.run(`
			const win = await computer.window({ app: "Code" });
			await win.menu.items();
			await win.menu.items(["File"]);
			await win.menu.select(["File", "Export…", "PDF"]);
		`)

    // Then
    expect(kernel.calls).toEqual([
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

  it("forwards a win.menu.select delivery option as a second argument (#9888)", async () => {
    // Given
    const kernel = loadJsFacade(windowResponder)

    // When
    await kernel.run(`
			const win = await computer.window({ app: "Code" });
			await win.menu.select(["File", "Save"], { delivery: "foreground" });
		`)

    // Then
    expect(kernel.calls.at(-1)).toEqual({
      action: "call",
      chain: [
        { method: "window", args: ["w1"] },
        { method: "menu.select", args: [["File", "Save"], { delivery: "foreground" }] },
      ],
    })
  })

  it("returns the items array from win.menu.items", async () => {
    // Given
    const menu = [{ title: "File", path: ["File"], enabled: true, checked: false, hasSubmenu: true, shortcut: null }]
    const kernel = loadJsFacade((args) => {
      const chain = Array.isArray(args.chain) ? args.chain : []
      if (chain.length === 1 && chain[0].method === "window") {
        return { text: "", details: { value: WINDOW_SNAPSHOT } }
      }
      return { text: "", details: { value: menu } }
    })

    // When
    const value = await kernel.run(`return (await computer.window("w1")).menu.items(["File"]);`)

    // Then
    expect(value).toEqual(menu)
  })

  it("sends el.type as a ref-hopped chain and returns how the text was delivered", async () => {
    // Given
    const kernel = loadJsFacade((args) => {
      const chain = Array.isArray(args.chain) ? args.chain : []
      if (chain.length === 1 && chain[0].method === "ref") return { text: "", details: { value: ELEMENT_SNAPSHOT } }
      return { text: "", details: { value: { method: "inserted" } } }
    })

    // When
    const value = await kernel.run(`
			const el = await computer.ref("e1");
			return el.type("hello", { delivery: "foreground" });
		`)

    // Then
    expect(value).toEqual({ method: "inserted" })
    expect(kernel.calls).toEqual([
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

  it("sends control helpers as one-step call chains (#9651 B5b)", async () => {
    // Given
    const kernel = loadJsFacade(() => ({ text: "", details: { value: { active: true } } }))

    // When
    const acquired = await kernel.run(`return await computer.control.acquire({ reason: "click Run" });`)
    const state = await kernel.run("return await computer.control.state();")
    await kernel.run("await computer.control.release();")

    // Then
    expect({ acquired, state }).toEqual({ acquired: { active: true }, state: { active: true } })
    expect(kernel.calls).toEqual([
      { action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
      { action: "call", chain: [{ method: "control.state", args: [] }] },
      { action: "call", chain: [{ method: "control.release", args: [] }] },
    ])
  })
})
