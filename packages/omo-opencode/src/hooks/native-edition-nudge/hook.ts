import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getUserConfigDir } from "../auto-update-checker/constants"

export const NATIVE_NUDGE_TOAST_TITLE = "OmO Native"
export const NATIVE_NUDGE_TOAST_MESSAGE =
  "OmO Native - the OmO agent runtime as one binary, no host app needed. Get it at https://omo.dev"

export function nativeEditionStateDir(): string {
  return join(getUserConfigDir(), "oh-my-openagent")
}

export function createNativeEditionNudgeHook(ctx: PluginInput) {
  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return
      const showToast = ctx.client?.tui?.showToast
      if (typeof showToast !== "function") return
      void showToast({
        body: {
          title: NATIVE_NUDGE_TOAST_TITLE,
          message: NATIVE_NUDGE_TOAST_MESSAGE,
          variant: "info" as const,
          duration: 8000,
        },
      }).catch(() => {})
    },
  }
}
