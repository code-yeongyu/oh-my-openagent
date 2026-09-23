import { NATIVE_EDITION_GUIDE_URL } from "../../cli/native-edition-hint"
import { formatNativeInstallCommand, NATIVE_SETUP_COMMAND, resolveNativeInstallPlan } from "../../cli/install-native"
import {
  createNudgeStateStore,
  nativeEditionStateDir,
  type NudgeState,
  type NudgeStateStore,
} from "../../hooks/native-edition-nudge"
import { NUDGE_SNOOZE_MS, NUDGE_STATE_VERSION } from "../../hooks/native-edition-nudge/types"

export type NativeEditionNudgeAction = "install" | "guide" | "later" | "never"

export const NATIVE_NUDGE_DIALOG_TITLE = "OmO Native"

export const NATIVE_NUDGE_OPTIONS: readonly { readonly value: NativeEditionNudgeAction; readonly title: string }[] = [
  { value: "install", title: "Install OmO Native" },
  { value: "guide", title: "Open the guide" },
  { value: "later", title: "Remind me in a week" },
  { value: "never", title: "Don't ask again" },
]

function baseState(now: number): NudgeState {
  return {
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows: 0,
    lastShownAt: null,
    nextEligibleAt: now,
    decision: "none",
    decidedAt: null,
    writtenBy: "tui",
  }
}

function currentState(store: NudgeStateStore, now: number): NudgeState {
  const read = store.read()
  return read === "missing" || read === "corrupt" ? baseState(now) : read
}

export type NativeEditionNudgeActionResult = {
  readonly toast: string
  readonly url?: string
}

export function applyNativeEditionNudgeAction(
  action: NativeEditionNudgeAction,
  options: { readonly store: NudgeStateStore; readonly now: number; readonly bunAvailable: boolean },
): NativeEditionNudgeActionResult {
  const state = currentState(options.store, options.now)

  if (action === "install") {
    const command = formatNativeInstallCommand(resolveNativeInstallPlan(options.bunAvailable))
    // Handed over, not spawned: a global install has no rollback and this dialog has no progress
    // surface to report a partial failure. Nothing is recorded either, so the nudge keeps working
    // until the edition is actually detected on disk - an install that exits 0 without landing
    // must never silence the user permanently.
    return { toast: `Run: ${command}\nThen: ${NATIVE_SETUP_COMMAND}` }
  }

  if (action === "guide") {
    options.store.write({ ...state, nextEligibleAt: options.now + NUDGE_SNOOZE_MS, writtenBy: "tui" })
    return { toast: "Opening the OmO Native guide.", url: NATIVE_EDITION_GUIDE_URL }
  }

  if (action === "later") {
    // A reminder the user asked for is not nagging, so this does NOT count toward the lifetime cap.
    options.store.write({
      ...state,
      nextEligibleAt: options.now + NUDGE_SNOOZE_MS,
      decision: "snoozed",
      decidedAt: options.now,
      writtenBy: "tui",
    })
    return { toast: "I'll mention OmO Native again in a week." }
  }

  options.store.write({ ...state, decision: "never", decidedAt: options.now, writtenBy: "tui" })
  return { toast: "I won't bring up OmO Native again. The command palette entry stays available." }
}

type TuiApi = {
  readonly command?: {
    readonly register: (factory: () => readonly unknown[]) => (() => void) | undefined
  }
  readonly ui: {
    readonly dialog: { readonly replace: (render: () => unknown) => void; readonly clear: () => void }
    readonly DialogSelect: <T>(props: unknown) => unknown
    readonly toast?: (input: unknown) => void
  }
}

export function registerNativeEditionNudgeTui(api: TuiApi, deps: { readonly store?: NudgeStateStore } = {}): () => void {
  const store = deps.store ?? createNudgeStateStore(nativeEditionStateDir())

  const open = (): void => {
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<NativeEditionNudgeAction>({
        title: NATIVE_NUDGE_DIALOG_TITLE,
        placeholder: "The same omo as one command, with no host app",
        options: NATIVE_NUDGE_OPTIONS.map((option) => ({ title: option.title, value: option.value })),
        onSelect: (option: { value: NativeEditionNudgeAction }) => {
          const result = applyNativeEditionNudgeAction(option.value, {
            store,
            now: Date.now(),
            bunAvailable: true,
          })
          api.ui.dialog.clear()
          api.ui.toast?.({ message: result.toast })
        },
      }),
    )
  }

  return (
    api.command?.register(() => [
      {
        title: "OmO Native",
        value: "omo.native.nudge",
        description: "Install the standalone OmO Native edition, or stop being reminded about it",
        category: "Session",
        enabled: true,
        slash: { name: "native", aliases: ["omo-native"] },
        onSelect: open,
      },
    ]) ?? (() => undefined)
  )
}
