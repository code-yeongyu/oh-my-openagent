import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectGeetest(page: Page): Promise<DetectedChallenge | null> {
  const v4Marker = await page.$(".geetest_holder_v4, .geetest_v4")
  if (v4Marker) {
    return { kind: "geetest_v4", confidence: 0.9, selector: ".geetest_holder_v4" }
  }
  const v4Global = await page.evaluate(() => {
    const w = window as unknown as { initGeetest4?: unknown; geetest?: { config?: { api_server?: string } } }
    if (typeof w.initGeetest4 === "function") return true
    return Boolean(w.geetest?.config?.api_server?.includes("v4"))
  })
  if (v4Global) {
    return { kind: "geetest_v4", confidence: 0.85, selector: "body" }
  }

  const v3Marker = await page.$(".geetest_box, .geetest_panel, .geetest_radar_btn")
  if (v3Marker) {
    return { kind: "geetest_v3", confidence: 0.9, selector: ".geetest_box" }
  }
  const v3Global = await page.evaluate(() => {
    const w = window as unknown as { initGeetest?: unknown }
    return typeof w.initGeetest === "function"
  })
  if (v3Global) {
    return { kind: "geetest_v3", confidence: 0.8, selector: "body" }
  }

  return null
}
