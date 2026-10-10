import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getUserConfigDir } from "../auto-update-checker/constants"
import { createNudgeStateStore, type NudgeStateStore } from "./state"

export const NATIVE_NUDGE_TOAST_TITLE = "OmO Native"
export const NATIVE_NUDGE_TOAST_MESSAGE =
  "OmO Native - the OmO agent runtime as one binary, no host app needed. Get it at https://omo.dev"

export function nativeEditionStateDir(): string {
  return join(getUserConfigDir(), "oh-my-openagent")
}

export function detectNativeEdition(): boolean {
  return existsSync(join(homedir(), ".omo", "agent"))
}

type NativeEditionNudgeDeps = {
  readonly store?: NudgeStateStore
  readonly detectNativeEdition?: () => boolean
}

export function createNativeEditionNudgeHook(ctx: PluginInput, deps: NativeEditionNudgeDeps = {}) {
  // Once per launch: the toast recommends trying the native edition, so one recommendation per
  // OpenCode process is the whole point - re-toasting on every session in the same process is
  // the nagging the per-session tracking used to produce.
  let shownThisProcess = false
  const store = deps.store ?? createNudgeStateStore(nativeEditionStateDir())
  const detect = deps.detectNativeEdition ?? detectNativeEdition

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return
      if (shownThisProcess) return
      // Users who already run OmO Native, or who recorded "never" in the nudge dialog, keep their
      // answer: an every-launch recommendation may not resurrect a dismissal they made for good.
      if (detect()) return
      const state = store.read()
      if (state !== "missing" && state !== "corrupt" && (state.decision === "never" || state.decision === "migrated")) {
        return
      }
      const tui = ctx.client?.tui
      if (typeof tui?.showToast !== "function") return
      shownThisProcess = true
      // The SDK method reads `this._client`, so it must be called with the tui receiver, never
      // detached. It can also throw synchronously when the client is gone; the .catch only covers
      // async rejections, so the synchronous throw gets its own guard.
      try {
        void tui.showToast({
          body: {
            title: NATIVE_NUDGE_TOAST_TITLE,
            message: NATIVE_NUDGE_TOAST_MESSAGE,
            variant: "info" as const,
            duration: 8000,
          },
        }).catch(() => {})
      } catch {
        // The toast API can throw synchronously when the client is already gone.
      }
    },
  }
}
