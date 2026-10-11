import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { NATIVE_EDITION_INSTALL_COMMAND } from "../../cli/native-edition-hint"
import { log } from "../../shared/logger"
import { getUserConfigDir } from "../auto-update-checker/constants"
import { decideNativeEditionNudge } from "./decide"
import { createNudgeStateStore, type NudgeStateStore } from "./state"
import { NUDGE_SNOOZE_MS, type NudgeState } from "./types"

export const NATIVE_NUDGE_TOAST_TITLE = "Try OmO Native: no host app needed"
export const NATIVE_NUDGE_TOAST_MESSAGE =
  `Same agent, one binary, nothing else to keep updated.\nInstall: ${NATIVE_EDITION_INSTALL_COMMAND}`

export function nativeEditionStateDir(): string {
  return join(getUserConfigDir(), "oh-my-openagent")
}

export function detectNativeEdition(): boolean {
  return existsSync(join(homedir(), ".omo", "agent"))
}

type NativeEditionNudgeDeps = {
  readonly store?: NudgeStateStore
  readonly detectNativeEdition?: () => boolean
  readonly now?: () => number
  readonly interactive?: () => boolean
  readonly version?: string
  readonly log?: typeof log
}

function defaultInteractive(): boolean {
  if (process.env["CI"] !== undefined && process.env["CI"] !== "") return false
  if (process.env["OMO_NON_INTERACTIVE"] === "1") return false
  return process.stdout.isTTY === true
}

export function createNativeEditionNudgeHook(ctx: PluginInput, deps: NativeEditionNudgeDeps = {}) {
  let shownThisProcess = false
  const store = deps.store ?? createNudgeStateStore(nativeEditionStateDir())
  const detect = deps.detectNativeEdition ?? detectNativeEdition
  const now = deps.now ?? (() => Date.now())
  const interactive = deps.interactive ?? defaultInteractive
  const version = deps.version ?? "unknown"
  const logFn = deps.log ?? log

  const persist = (next: NudgeState | null): boolean => (next === null ? true : store.write(next))

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      const props = event.properties as { info?: { parentID?: string } } | undefined

      const decision = decideNativeEditionNudge({
        now: now(),
        state: store.read(),
        nativeEditionInstalled: detect(),
        hookDisabled: false,
        interactive: interactive(),
        childSession: props?.info?.parentID !== undefined,
        shownThisProcess,
        stateWritable: store.probeWritable(),
        toastAvailable: typeof ctx.client?.tui?.showToast === "function",
        version,
      })

      if (!decision.show) {
        persist(decision.nextState)
        return
      }

      // Claim the slot before showing. If the write fails the toast is skipped entirely, because a
      // nudge that cannot record itself would reappear on every session start.
      if (!persist(decision.nextState)) {
        logFn("[native-edition-nudge] state write failed; suppressing the toast")
        return
      }
      shownThisProcess = true

      await ctx.client.tui
        .showToast({
          body: {
            title: NATIVE_NUDGE_TOAST_TITLE,
            message: NATIVE_NUDGE_TOAST_MESSAGE,
            variant: "info" as const,
            duration: 10000,
          },
        })
        .catch(() => {})
    },
  }
}

export function snoozeNativeEditionNudge(store: NudgeStateStore, state: NudgeState, at: number, version: string): void {
  store.write({ ...state, nextEligibleAt: at + NUDGE_SNOOZE_MS, decision: "snoozed", decidedAt: at, writtenBy: version })
}
