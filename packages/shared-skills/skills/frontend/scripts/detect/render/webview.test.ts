import { afterAll, describe, expect, test } from "bun:test"
import { detectPage } from "../detect"
import { createWebViewRenderer } from "./webview"

const renderer = createWebViewRenderer()
afterAll(() => renderer.close())

const page = (css: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title><style>${css}</style></head><body><main><h1>Hello</h1><p>Plain text.</p></main></body></html>`

const reflowFindings = async (html: string) =>
  (await detectPage({ kind: "html", html }, { renderer, viewports: [], reflow: true })).filter(
    (f) => f.ruleId === "viewport-reflow",
  )

describe("createWebViewRenderer", () => {
  test("#given a plain render #then the page snapshot comes back", async () => {
    const snapshot = await renderer.render({
      target: { kind: "html", html: page("") },
      viewport: { width: 320, height: 800 },
    })
    expect(snapshot.elements.length).toBeGreaterThan(0)
  }, 30_000)

  test("#given content stress and text that cannot wrap #then the 320 px pass reports viewport reflow", async () => {
    expect(await reflowFindings(page("p { width: 200px }"))).toHaveLength(1)
  }, 60_000)

  test("#given content stress and text that wraps #then no viewport reflow is reported", async () => {
    expect(await reflowFindings(page("h1, p { overflow-wrap: anywhere }"))).toEqual([])
  }, 60_000)
})
