import type { Page } from "playwright-core"
import { extractMainContent } from "../observation/dom-extract"

export type ExtractOptions = {
  selector?: string
  attribute?: string
  format?: "text" | "html" | "json"
}

export type ExtractResult = {
  content: string
  wordCount: number
  url: string
  title: string
}

export async function extract(page: Page, options: ExtractOptions = {}): Promise<ExtractResult> {
  if (options.selector) {
    return extractBySelector(page, options.selector, options.attribute, options.format)
  }

  const main = await extractMainContent(page)
  return {
    content: main.text,
    wordCount: main.wordCount,
    url: main.url,
    title: main.title,
  }
}

async function extractBySelector(
  page: Page,
  selector: string,
  attribute?: string,
  format?: "text" | "html" | "json",
): Promise<ExtractResult> {
  const element = await page.waitForSelector(selector, { timeout: 10_000 })
  if (!element) throw new Error(`Element not found: ${selector}`)

  let content: string
  if (attribute) {
    content = await element.getAttribute(attribute) ?? ""
  } else if (format === "html") {
    content = await element.innerHTML()
  } else {
    content = await element.textContent() ?? ""
  }

  content = content.trim()

  return {
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    url: page.url(),
    title: await page.title(),
  }
}
