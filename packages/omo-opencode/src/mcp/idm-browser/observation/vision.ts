import type { Page } from "playwright-core"

export type VisionObservation = {
  screenshotBase64: string
  description?: string
  elements?: Array<{ label: string; boundingBox: { x: number; y: number; w: number; h: number } }>
}

export async function captureVisionSnapshot(page: Page): Promise<VisionObservation> {
  const screenshot = await page.screenshot({ type: "png", fullPage: false })
  const base64 = Buffer.from(screenshot).toString("base64")

  return {
    screenshotBase64: base64,
  }
}
