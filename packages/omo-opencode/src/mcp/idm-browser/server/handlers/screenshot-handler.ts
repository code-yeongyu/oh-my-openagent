import type { BrowserPool } from "../../pool"

export type ScreenshotStrategy = "tile" | "clip" | "viewport"

export type ScreenshotParams = {
  fullPage?: boolean
  selector?: string
  strategy?: ScreenshotStrategy
  max_dimension_px?: number
  sessionId?: string
  accountId?: string
}

const DEFAULT_MAX_DIMENSION = 7500

export async function handleScreenshot(pool: BrowserPool, params: ScreenshotParams) {
  const session = await pool.acquire(params.sessionId)
  const maxDim = params.max_dimension_px ?? DEFAULT_MAX_DIMENSION

  if (params.selector) {
    const element = await session.page.waitForSelector(params.selector, { timeout: 10_000 })
    if (!element) {
      return {
        content: [{ type: "text" as const, text: `Element not found: ${params.selector}` }],
        isError: true,
      }
    }
    const buf = await element.screenshot({ type: "png" })
    return {
      content: [{
        type: "image" as const,
        data: Buffer.from(buf).toString("base64"),
        mimeType: "image/png",
      }],
    }
  }

  if (!params.fullPage) {
    const buf = await session.page.screenshot({ type: "png", fullPage: false })
    return {
      content: [{
        type: "image" as const,
        data: Buffer.from(buf).toString("base64"),
        mimeType: "image/png",
      }],
    }
  }

  const dimensions = await session.page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }))

  const exceedsLimit = dimensions.width > maxDim || dimensions.height > maxDim
  const strategy: ScreenshotStrategy = params.strategy ?? (exceedsLimit ? "tile" : "clip")

  if (!exceedsLimit || strategy === "viewport") {
    const buf = await session.page.screenshot({ type: "png", fullPage: !exceedsLimit })
    return {
      content: [{
        type: "image" as const,
        data: Buffer.from(buf).toString("base64"),
        mimeType: "image/png",
      }],
    }
  }

  if (strategy === "clip") {
    const clipWidth = Math.min(dimensions.width, maxDim)
    const clipHeight = Math.min(dimensions.height, maxDim)
    const buf = await session.page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
    })
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            warning: "Page exceeded max_dimension_px; clipped to safe size",
            page: dimensions,
            clipped: { width: clipWidth, height: clipHeight },
          }, null, 2),
        },
        {
          type: "image" as const,
          data: Buffer.from(buf).toString("base64"),
          mimeType: "image/png",
        },
      ],
    }
  }

  const tileHeight = maxDim
  const totalHeight = Math.min(dimensions.height, maxDim * 8)
  const tileWidth = Math.min(dimensions.width, maxDim)
  const tileCount = Math.ceil(totalHeight / tileHeight)

  const tiles: { type: "image"; data: string; mimeType: string }[] = []
  for (let i = 0; i < tileCount; i++) {
    const y = i * tileHeight
    const h = Math.min(tileHeight, totalHeight - y)
    if (h <= 0) break
    const buf = await session.page.screenshot({
      type: "png",
      clip: { x: 0, y, width: tileWidth, height: h },
    })
    tiles.push({
      type: "image",
      data: Buffer.from(buf).toString("base64"),
      mimeType: "image/png",
    })
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          strategy: "tile",
          page: dimensions,
          tile: { width: tileWidth, height: tileHeight, count: tiles.length },
          truncated: dimensions.height > maxDim * 8,
        }, null, 2),
      },
      ...tiles,
    ],
  }
}
