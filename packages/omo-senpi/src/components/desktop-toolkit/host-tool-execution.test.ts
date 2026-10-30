/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { SenpiExtensionAPI } from "../../extension/types"
import { registerHostToolExecution } from "./host-tool-execution"

const ARGS = { html: "<p>page</p>", title: "Page", height: 300 }
const RESULT = { content: [{ type: "text", text: "Wrote the page." }], details: { html: ARGS.html, prepared: true } }

function host(options: { names?: string[]; cwd?: string; writer?: unknown } = {}) {
  const pi = new FakeExtensionAPI()
  Object.defineProperty(pi, "cwd", { value: options.cwd ?? "/work/thread" })
  const handlers = new Map<string, (data: unknown, context?: unknown) => unknown>()
  const rpc: NonNullable<SenpiExtensionAPI["rpc"]> = { emit: () => {}, handle: (name, handler) => { handlers.set(name, handler) } }
  pi.rpc = rpc
  const calls: unknown[][] = []
  const writer = options.writer ?? ((...args: unknown[]) => { calls.push(args); return Promise.resolve(RESULT) })
  registerHostToolExecution(pi, new Set(options.names ?? ["show_html_page"]), () => Promise.resolve({ writeHtmlPage: writer }))
  let admitted = 0
  const context = { ownerId: "A", disconnectSignal: new AbortController().signal, admit: <T>(dispatch: () => T) => { admitted += 1; return dispatch() } }
  const execute = (data: unknown, withContext = true) => handlers.get("omo.toolkit.executeHostTool")?.(data, withContext ? context : undefined)
  return { execute, calls, admitted: () => admitted }
}

describe("host tool execution", () => {
  it("#11897: runs the SDK writer in the session cwd through the admitted request and returns its result unchanged", async () => {
    const h = host()
    expect(await h.execute({ name: "show_html_page", args: ARGS })).toEqual(RESULT)
    expect(h.calls).toEqual([[ARGS, "/work/thread"]])
    expect(h.admitted()).toBe(1)
  })

  for (const row of [
    { why: "an undeclared name", names: ["other_tool"], data: { name: "show_html_page", args: ARGS }, withContext: true },
    { why: "invalid arguments", names: ["show_html_page"], data: { name: "show_html_page", args: { title: "x" } }, withContext: true },
    { why: "no request context", names: ["show_html_page"], data: { name: "show_html_page", args: ARGS }, withContext: false },
  ]) {
    it(`refuses ${row.why} without writing`, async () => {
      const h = host({ names: row.names })
      const result = await h.execute(row.data, row.withContext)
      expect(result).toMatchObject({ isError: true })
      expect(h.calls).toEqual([])
    })
  }

  it("reports a pinned SDK without the writer instead of substituting another preparation", async () => {
    const h = host({ writer: "not a function" })
    expect(await h.execute({ name: "show_html_page", args: ARGS })).toEqual({
      isError: true, content: [{ type: "text", text: "The pinned SDK does not provide writeHtmlPage." }], details: {},
    })
  })
})
