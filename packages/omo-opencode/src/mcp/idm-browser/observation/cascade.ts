import type { Page } from "playwright-core"
import { captureAXTreeSnapshot, type AXTreeSnapshot } from "./axtree"
import { extractMainContent, type ExtractedContent } from "./dom-extract"
import { captureVisionSnapshot, type VisionObservation } from "./vision"

export type ObservationLevel = "axtree" | "dom" | "vision" | "full"

export type CascadeResult = {
  axtree?: AXTreeSnapshot
  dom?: ExtractedContent
  vision?: VisionObservation
  level: ObservationLevel
}

export async function observeCascade(
  page: Page,
  level: ObservationLevel = "axtree",
  query?: string,
): Promise<CascadeResult> {
  const result: CascadeResult = { level }

  result.axtree = await captureAXTreeSnapshot(page, query)

  if (level === "axtree") return result

  result.dom = await extractMainContent(page)

  if (level === "dom") return result

  result.vision = await captureVisionSnapshot(page)

  return result
}
