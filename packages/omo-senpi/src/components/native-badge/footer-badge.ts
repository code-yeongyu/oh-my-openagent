import { isDevBuildRuntime } from "../agent-home/dev-build-runtime"

const NATIVE_BADGE_STATUS_KEY = "  omo-native"
const NATIVE_BADGE_TEXT = "(😺 OmO Native by Q Kim)"
const NATIVE_BADGE_DEV_BUILD_TEXT = "(☕ OmO Native by Q Kim)"

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

export function resolveNativeBadgeText(env: NodeJS.ProcessEnv = process.env): string {
  return isDevBuildRuntime(env) ? NATIVE_BADGE_DEV_BUILD_TEXT : NATIVE_BADGE_TEXT
}

export function createNativeBadgeStatus(text: string = resolveNativeBadgeText()): NativeBadgeStatus {
  return {
    publish(eventCtx) {
      uiFromContext(eventCtx)?.setStatus(NATIVE_BADGE_STATUS_KEY, text)
    },
    clear(eventCtx) {
      uiFromContext(eventCtx)?.setStatus(NATIVE_BADGE_STATUS_KEY, undefined)
    },
  }
}

export { NATIVE_BADGE_DEV_BUILD_TEXT, NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT }
