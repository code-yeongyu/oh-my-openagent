/// <reference lib="dom" />
import type { Page } from "playwright-core"
import type { ObservableElement } from "../primitives"
import { observeAXTree } from "../primitives"

export type AXTreeSnapshot = {
  url: string
  title: string
  elements: ObservableElement[]
  interactiveCount: number
  timestamp: number
}

export async function captureAXTreeSnapshot(page: Page, query?: string): Promise<AXTreeSnapshot> {
  const elements = await observeAXTree(page, query)

  return {
    url: page.url(),
    title: await page.title(),
    elements,
    interactiveCount: elements.filter(e => e.isInteractive).length,
    timestamp: Date.now(),
  }
}

export async function injectAxIds(page: Page): Promise<void> {
  await page.evaluate(() => {
    let counter = 0
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
    )
    let node = walker.nextNode()
    while (node) {
      if (node instanceof HTMLElement && !node.dataset.mcpAxid) {
        node.dataset.mcpAxid = String(counter++)
      }
      node = walker.nextNode()
    }
  })
}
