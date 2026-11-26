import { afterAll, describe, expect, test } from "bun:test"
import { lintSnapshot } from "../lint"
import { viewportReflow } from "../rules/layout/viewport-reflow"
import { createWebViewRenderer } from "./webview"

const renderer = createWebViewRenderer()
afterAll(() => renderer.close())

const page = (css: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title><style>${css}</style></head><body><main><h1>Hello</h1><p>Plain text.</p></main></body></html>`

const stressedReflowFindings = async (html: string) => {
  const snapshot = await renderer.render({
    target: { kind: "html", html },
    viewport: { width: 320, height: 800 },
    contentStress: true,
  })
  return lintSnapshot(snapshot, { rules: [viewportReflow] })
}

describe("createWebViewRenderer", () => {
  test("#given a plain render #then the page snapshot comes back", async () => {
    const snapshot = await renderer.render({
      target: { kind: "html", html: page("") },
      viewport: { width: 320, height: 800 },
    })
    expect(snapshot.elements.length).toBeGreaterThan(0)
  })

  test("#given content stress and text that cannot wrap #then the 320 px render reports viewport reflow", async () => {
    expect(await stressedReflowFindings(page("p { width: 200px }"))).toHaveLength(1)
  })

  test("#given content stress and text that wraps #then no viewport reflow is reported", async () => {
    expect(await stressedReflowFindings(page("h1, p { overflow-wrap: anywhere }"))).toEqual([])
  })
})
