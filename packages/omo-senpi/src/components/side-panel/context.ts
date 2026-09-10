import type { PanelHostContext, PanelUi } from "./types"

/**
 * senpi carries `ui` on event contexts, not on ExtensionAPI, and does not declare it
 * on the adapter's structural port. It is captured here the same way the native badge
 * captures `setStatus`: guard the shape, then call through `Reflect.apply` so the host
 * keeps its own receiver.
 */
export function panelContextFrom(value: unknown): PanelHostContext | undefined {
  if (!isRecord(value)) return undefined
  const ui = value["ui"]
  if (!isRecord(ui)) return undefined
  const setWidget = ui["setWidget"]
  if (typeof setWidget !== "function") return undefined
  const notify = ui["notify"]
  const port: PanelUi = {
    setWidget(key, content, options) {
      Reflect.apply(setWidget, ui, [key, content, options])
    },
    notify(message, type) {
      if (typeof notify !== "function") return
      Reflect.apply(notify, ui, [message, type])
    },
  }
  return {
    ui: port,
    mode: typeof value["mode"] === "string" ? value["mode"] : undefined,
    hasUI: value["hasUI"] === true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
