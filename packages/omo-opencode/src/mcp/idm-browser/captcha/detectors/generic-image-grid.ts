import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectGenericImageGrid(page: Page): Promise<DetectedChallenge | null> {
  const detected = await page.evaluate(() => {
    const promptKeywords = [
      /trascina/i,
      /trova\s+tutt/i,
      /seleziona/i,
      /select all/i,
      /find all/i,
      /drag the/i,
      /please select/i,
    ]
    const allText = document.body?.innerText ?? ""
    const hasPrompt = promptKeywords.some((re) => re.test(allText))
    if (!hasPrompt) return null
    const grids = Array.from(document.querySelectorAll("div, section")).filter((el) => {
      const imgs = el.querySelectorAll("img, canvas")
      return imgs.length >= 6 && imgs.length <= 16
    })
    if (grids.length === 0) return null
    const grid = grids[0]
    const id = grid?.id ?? ""
    const cls = grid?.className ?? ""
    return { id: typeof id === "string" ? id : "", cls: typeof cls === "string" ? cls : "" }
  })
  if (!detected) return null
  return {
    kind: "image_grid_puzzle",
    confidence: 0.7,
    selector: detected.id ? `#${detected.id}` : undefined,
  }
}
