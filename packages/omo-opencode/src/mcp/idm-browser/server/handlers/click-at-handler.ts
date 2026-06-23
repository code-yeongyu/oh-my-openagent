import type { Page } from "playwright-core"
import type { BrowserPool } from "../../pool"
import { humanClick } from "../../behavior"

export type ClickAtModifier = "Alt" | "Control" | "Meta" | "Shift"
export type ClickAtButton = "left" | "middle" | "right"

export type ClickAtParams = {
  x: number
  y: number
  sessionId?: string
  accountId?: string
  button?: ClickAtButton
  modifiers?: ClickAtModifier[]
  humanize?: boolean
  delay_ms?: number
}

export async function handleClickAt(pool: BrowserPool, params: ClickAtParams) {
  const session = await pool.acquire(params.sessionId)
  const humanize = resolveHumanizeMode(params.humanize)
  const button = params.button ?? "left"

  if (!isFiniteNonNegative(params.x) || !isFiniteNonNegative(params.y)) {
    return errorPayload(session.id, params, humanize, button, `Invalid coordinates: x=${params.x}, y=${params.y}`)
  }

  try {
    const modifiers = params.modifiers ?? []
    if (humanize) {
      await withModifiers(session.page, modifiers, () =>
        humanClick(session.page, { x: params.x, y: params.y }, {
          preClickDelayMs: params.delay_ms,
        }),
      )
    } else {
      const delay = typeof params.delay_ms === "number" ? params.delay_ms : pickClickDelay()
      await withModifiers(session.page, modifiers, () =>
        session.page.mouse.click(params.x, params.y, { button, delay }),
      )
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          x: params.x,
          y: params.y,
          button,
          humanize,
          success: true,
        }),
      }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorPayload(session.id, params, humanize, button, message)
  }
}

function errorPayload(
  sessionId: string,
  params: ClickAtParams,
  humanize: boolean,
  button: ClickAtButton,
  message: string,
) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        sessionId,
        x: params.x,
        y: params.y,
        button,
        humanize,
        success: false,
        error: message,
      }),
    }],
    isError: true,
  }
}

function resolveHumanizeMode(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") return explicit
  const env = process.env.BROWSER_HUMANIZE
  return env === "true" || env === "1"
}

function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0
}

function pickClickDelay(): number {
  return 80 + Math.floor(Math.random() * (180 - 80 + 1))
}

async function withModifiers<T>(page: Page, modifiers: ClickAtModifier[], fn: () => Promise<T>): Promise<T> {
  for (const mod of modifiers) {
    await page.keyboard.down(mod)
  }
  try {
    return await fn()
  } finally {
    for (const mod of [...modifiers].reverse()) {
      await page.keyboard.up(mod).catch(() => undefined)
    }
  }
}
