import { readFileSync } from "node:fs"
import { join } from "node:path"

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

// An omob dev build stamps `omoBuild` into the runtime payload's package.json and the launcher
// points OMO_PACKAGE_DIR at that payload; release payloads carry no stamp. SENPI_BRAND also names
// the dev command, but the engine consumes and scrubs it before any extension runs.
function isDevBuildRuntime(env: NodeJS.ProcessEnv): boolean {
  const packageDir = env.OMO_PACKAGE_DIR
  if (packageDir === undefined || packageDir.trim().length === 0) return false
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
  } catch {
    return false
  }
  if (!isRecord(manifest)) return false
  const stamp = manifest["omoBuild"]
  return isRecord(stamp) && typeof stamp["command"] === "string" && stamp["command"].length > 0
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
