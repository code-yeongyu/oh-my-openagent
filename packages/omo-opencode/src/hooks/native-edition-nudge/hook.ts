import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared/logger"
import { getUserConfigDir } from "../auto-update-checker/constants"
import { decideNativeEditionNudge } from "./decide"
import { createNudgeStateStore, type NudgeStateStore } from "./state"
import type { NudgeState } from "./types"

export const NATIVE_NUDGE_TOAST_TITLE = "OmO Native"
export const NATIVE_NUDGE_TOAST_MESSAGE =
  "OmO Native - the OmO agent runtime as one binary, no host app needed. Get it at https://omo.dev"

export function nativeEditionStateDir(): string {
  return join(getUserConfigDir(), "oh-my-openagent")
}

export function detectNativeEdition(): boolean {
  return existsSync(join(homedir(), ".omo", "agent"))
}

export function isInteractiveLaunch(env: NodeJS.ProcessEnv, stdoutIsTTY: boolean | undefined): boolean {
  if (env["CI"] !== undefined && env["CI"] !== "") return false
  if (env["OMO_NON_INTERACTIVE"] === "1") return false
  return stdoutIsTTY === true
}

type NativeEditionNudgeDeps = {
  readonly store?: NudgeStateStore
  readonly detectNativeEdition?: () => boolean
  readonly now?: () => number
  readonly interactive?: () => boolean
  readonly version?: string
  readonly log?: typeof log
}

export function createNativeEditionNudgeHook(ctx: PluginInput, deps: NativeEditionNudgeDeps = {}) {
  let shownThisProcess = false
  const store = deps.store ?? createNudgeStateStore(nativeEditionStateDir())
  const detect = deps.detectNativeEdition ?? detectNativeEdition
  const now = deps.now ?? Date.now
  const interactive = deps.interactive ?? (() => isInteractiveLaunch(process.env, process.stdout.isTTY))
  const version = deps.version ?? "unknown"
  const logFn = deps.log ?? log

  const persist = (next: NudgeState | null): boolean => (next === null ? true : store.write(next))

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      const props = event.properties as { info?: { parentID?: string } } | undefined
      const tui = ctx.client?.tui

      const decision = decideNativeEditionNudge({
        now: now(),
        state: store.read(),
        nativeEditionInstalled: detect(),
        hookDisabled: false,
        interactive: interactive(),
        childSession: props?.info?.parentID !== undefined,
        shownThisProcess,
        stateWritable: store.probeWritable(),
        toastAvailable: typeof tui?.showToast === "function",
        version,
      })

      if (!decision.show) {
        persist(decision.nextState)
        return
      }

      // Record the show before the toast: a nudge that cannot record itself would reappear on every launch.
      if (!persist(decision.nextState)) {
        logFn("[native-edition-nudge] state write failed; suppressing the toast")
        return
      }
      shownThisProcess = true

      // The SDK method reads `this._client`, so it is called with the tui receiver. It can also throw
      // synchronously when the client is gone; `.catch` only covers async rejections.
      try {
        void tui?.showToast({
          body: {
            title: NATIVE_NUDGE_TOAST_TITLE,
            message: NATIVE_NUDGE_TOAST_MESSAGE,
            variant: "info" as const,
            duration: 8000,
          },
        }).catch(() => {})
      } catch {
        logFn("[native-edition-nudge] toast call threw synchronously")
      }
    },
  }
}
