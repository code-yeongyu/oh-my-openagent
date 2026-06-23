import type { Page } from "playwright-core"
import type { BrowserPool } from "../../pool"
import { createCurvedCursor, type HumanCursor } from "../../behavior"

export type ClickParams = {
  selector: string
  sessionId?: string
  accountId?: string
  humanize?: boolean
}

const cursorCache = new WeakMap<Page, HumanCursor>()

export async function handleClick(pool: BrowserPool, params: ClickParams) {
  const session = await pool.acquire(params.sessionId)
  const humanize = resolveHumanizeMode(params.humanize)

  try {
    const locator = session.page.locator(params.selector).first()
    await locator.waitFor({ state: "visible", timeout: 15_000 })

    if (humanize) {
      const cursor = getOrCreateCursor(session.page)
      await cursor.click(params.selector)
    } else {
      await locator.click()
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          selector: params.selector,
          humanize,
          success: true,
        }),
      }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          selector: params.selector,
          humanize,
          success: false,
          error: message,
        }),
      }],
      isError: true,
    }
  }
}

function resolveHumanizeMode(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") return explicit
  const env = process.env.BROWSER_HUMANIZE
  return env === "true" || env === "1"
}

function getOrCreateCursor(page: Page): HumanCursor {
  const cached = cursorCache.get(page)
  if (cached) return cached
  const cursor = createCurvedCursor(page)
  cursorCache.set(page, cursor)
  return cursor
}
