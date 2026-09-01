const NATIVE_BADGE_STATUS_KEY = "  omo-native"
const NATIVE_BADGE_TEXT = "(😺 OmO Native)"

interface NativeBadgeUi {
  setStatus(key: string, text: string | undefined): void
}

export interface NativeBadgeStatus {
  publish(eventCtx: unknown): void
  clear(eventCtx: unknown): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function uiFromContext(value: unknown): NativeBadgeUi | undefined {
  if (!isRecord(value)) return undefined
  const ui = value["ui"]
  if (!isRecord(ui)) return undefined
  const setStatus = ui["setStatus"]
  if (typeof setStatus !== "function") return undefined
  return {
    setStatus(key, text) {
      Reflect.apply(setStatus, ui, [key, text])
    },
  }
}

export function createNativeBadgeStatus(): NativeBadgeStatus {
  return {
    publish(eventCtx) {
      uiFromContext(eventCtx)?.setStatus(NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT)
    },
    clear(eventCtx) {
      uiFromContext(eventCtx)?.setStatus(NATIVE_BADGE_STATUS_KEY, undefined)
    },
  }
}

export { NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT }
