/// <reference lib="dom" />
import type { Page } from "playwright-core"

export type ExtractedContent = {
  text: string
  title: string
  url: string
  wordCount: number
}

export async function extractMainContent(page: Page): Promise<ExtractedContent> {
  const result = await page.evaluate(() => {
    const cloned = document.body.cloneNode(true) as HTMLElement
    const removeSelectors = [
      "script", "style", "noscript", "iframe", "svg",
      "nav", "header", "footer", "[role=navigation]",
      "[role=banner]", "[role=contentinfo]",
    ]
    for (const sel of removeSelectors) {
      cloned.querySelectorAll(sel).forEach(el => el.remove())
    }

    const main = cloned.querySelector("main, [role=main], article, .content, #content")
    const textSource = main ?? cloned
    const text = textSource.textContent?.replace(/\s+/g, " ").trim() ?? ""

    return {
      text,
      title: document.title,
      url: window.location.href,
    }
  })

  return {
    ...result,
    wordCount: result.text.split(/\s+/).filter(Boolean).length,
  }
}
