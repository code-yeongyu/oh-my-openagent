import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import { dispatchInput } from "./dom-helpers"

async function extractImageText(page: Page): Promise<CapsolverExtraction | null> {
  const body = await page.evaluate(() => {
    const img = document.querySelector("img[id*='captcha' i], img[src*='captcha' i]") as HTMLImageElement | null
    return img?.src ?? null
  })
  if (!body) return null
  return { taskExtra: { body } }
}

async function injectImageText(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const text = solution.text ?? solution.token
  if (!text) return false
  return dispatchInput(page, "input[name='captcha'], input[id*='captcha' i]", text)
}

export const imageTextOcrHandler: CapsolverTaskHandler = {
  taskType: "ImageToTextTask",
  extract: extractImageText,
  inject: injectImageText,
}
