import type { BrowserPool } from "../../pool"

export type PressParams = {
  key: string
  selector?: string
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">
  delay_ms?: number
  sessionId?: string
  accountId?: string
}

export async function handlePress(pool: BrowserPool, params: PressParams) {
  const session = await pool.acquire(params.sessionId)

  try {
    if (params.selector) {
      const locator = session.page.locator(params.selector).first()
      await locator.waitFor({ state: "visible", timeout: 15_000 })
      await locator.focus()
    }

    const composed = (params.modifiers ?? []).length > 0
      ? `${params.modifiers!.join("+")}+${params.key}`
      : params.key

    await session.page.keyboard.press(composed, { delay: params.delay_ms })

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          key: composed,
          selector: params.selector ?? null,
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
          key: params.key,
          success: false,
          error: message,
        }),
      }],
      isError: true,
    }
  }
}
