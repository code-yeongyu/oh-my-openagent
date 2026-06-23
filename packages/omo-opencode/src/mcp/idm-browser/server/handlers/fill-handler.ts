import type { BrowserPool } from "../../pool"

export type FillDispatchMode = "fill" | "keyboard" | "native"

export type FillParams = {
  selector: string
  value: string
  clear?: boolean
  dispatch?: FillDispatchMode
  delay_ms?: number
  sessionId?: string
  accountId?: string
}

export async function handleFill(pool: BrowserPool, params: FillParams) {
  const session = await pool.acquire(params.sessionId)
  const dispatch: FillDispatchMode = params.dispatch ?? "fill"

  try {
    const locator = session.page.locator(params.selector).first()
    await locator.waitFor({ state: "visible", timeout: 15_000 })

    let fallbackToNative = false
    if (dispatch === "keyboard") {
      await locator.click()
      if (params.clear) {
        await locator.fill("")
      }
      await locator.pressSequentially(params.value, { delay: params.delay_ms ?? 30 })
      const actual = await locator.inputValue().catch(() => "")
      if (actual !== params.value) {
        fallbackToNative = true
        await locator.evaluate((el, val) => {
          const target = el as HTMLInputElement | HTMLTextAreaElement
          const proto = Object.getPrototypeOf(target)
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
          setter?.call(target, val)
          target.dispatchEvent(new Event("input", { bubbles: true }))
          target.dispatchEvent(new Event("change", { bubbles: true }))
          target.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
        }, params.value)
      }
    } else if (dispatch === "native") {
      if (params.clear) {
        await locator.fill("")
      }
      await locator.fill(params.value)
      await locator.evaluate((el) => {
        const target = el as HTMLInputElement | HTMLTextAreaElement
        target.dispatchEvent(new Event("input", { bubbles: true }))
        target.dispatchEvent(new Event("change", { bubbles: true }))
        target.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
      })
    } else {
      if (params.clear) {
        await locator.fill("")
      }
      await locator.fill(params.value)
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sessionId: session.id,
          selector: params.selector,
          chars: params.value.length,
          dispatch,
          fallbackToNative,
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
          dispatch,
          success: false,
          error: message,
        }),
      }],
      isError: true,
    }
  }
}
