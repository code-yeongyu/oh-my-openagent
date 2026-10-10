import { isRecord } from "./guards"
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
  const custom = ui["custom"]
  const onTerminalInput = ui["onTerminalInput"]
  const port: PanelUi = {
    setWidget(key, content, options) {
      Reflect.apply(setWidget, ui, [key, content, options])
    },
    notify(message, type) {
      if (typeof notify !== "function") return
      Reflect.apply(notify, ui, [message, type])
    },
    // Raw input is how an open viewer claims the wheel; without it the wheel keeps scrolling
    // whatever sits behind the viewer, exactly as it did before.
    ...(typeof onTerminalInput === "function"
      ? {
          onTerminalInput(handler) {
            const stop: unknown = Reflect.apply(onTerminalInput, ui, [handler])
            return typeof stop === "function" ? (stop as () => void) : (): void => {}
          },
        }
      : {}),
    // The overlay seam is what a clicked row needs; a host without it degrades to `notify`.
    ...(typeof custom === "function"
      ? {
          custom(factory, options) {
            const opened: unknown = Reflect.apply(custom, ui, [factory, options])
            return opened instanceof Promise ? opened : Promise.resolve(opened)
          },
        }
      : {}),
  }
  return {
    ui: port,
    mode: typeof value["mode"] === "string" ? value["mode"] : undefined,
    hasUI: value["hasUI"] === true,
  }
}

