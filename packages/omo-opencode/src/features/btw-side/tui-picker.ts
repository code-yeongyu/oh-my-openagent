import type {
  TuiPluginApi,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import type { createBtwSideController } from "./tui-controller"
import {
  buildBtwPickerOptions,
  parseBtwPickerValue,
} from "./tui-picker-options"
import { loadBtwSessionCatalog } from "./tui-session-catalog"
import {
  adaptTuiPromptRef,
  currentTuiSessionID,
} from "./tui-session-bridge"

type BtwSideController = ReturnType<typeof createBtwSideController>

export async function openBtwPicker(args: {
  api: TuiPluginApi
  controller: BtwSideController
  activePromptRef: () => TuiPromptRef | undefined
}): Promise<boolean> {
  const currentSessionID = currentTuiSessionID(args.api)
  if (!currentSessionID) {
    args.api.ui.toast({
      variant: "warning",
      message: "BTW is unavailable before the session starts.",
    })
    return false
  }
  let loaded: Awaited<ReturnType<typeof loadBtwSessionCatalog>>
  try {
    loaded = await loadBtwSessionCatalog({
      currentSessionID,
      directory: args.api.state.path.directory,
      listSessions: (input) => args.api.client.session.list(input),
    })
  } catch (error) {
    log("[btw-side] Failed to list BTW sessions", {
      currentSessionID,
      error,
    })
    args.api.ui.toast({
      variant: "error",
      message: "Unable to list BTW conversations.",
    })
    return false
  }
  if (!loaded.catalog && loaded.truncated) {
    args.api.ui.toast({
      variant: "warning",
      message: "The BTW list is too large to show completely.",
    })
    return false
  }
  if (!loaded.catalog) {
    args.api.ui.toast({
      variant: "warning",
      message: "This BTW conversation no longer has a main session.",
    })
    return false
  }
  if (loaded.truncated) {
    args.api.ui.toast({
      variant: "warning",
      message: "The BTW list is too large to show completely.",
    })
  }

  for (const [index, side] of loaded.catalog.sides.entries()) {
    args.controller.adopt(loaded.catalog.main.id, side.id, index + 1)
  }
  const picker = buildBtwPickerOptions(
    loaded.catalog,
    currentSessionID,
  )

  async function refreshStaleSelection(sessionID: string): Promise<void> {
    args.api.ui.toast({
      variant: "warning",
      message: `BTW session ${sessionID} no longer exists. Refreshing the list.`,
    })
    await openBtwPicker(args)
  }

  async function select(value: string): Promise<void> {
    const selection = parseBtwPickerValue(value)
    if (!selection) return
    if (selection.type === "new") {
      const currentSessionID = currentTuiSessionID(args.api)
      const promptRef =
        currentSessionID === selection.parentSessionID
          ? args.activePromptRef()
          : undefined
      if (!promptRef) {
        args.api.ui.toast({
          variant: "warning",
          message: "BTW is unavailable before the session starts.",
        })
        return
      }
      const started = await args.controller.startFromPrompt(
        adaptTuiPromptRef(promptRef),
        selection.parentSessionID,
      )
      if (started) args.api.ui.dialog.clear()
      return
    }

    try {
      const response = await args.api.client.session.get({
        sessionID: selection.sessionID,
        directory: args.api.state.path.directory,
      })
      if (response.error !== undefined || response.data === undefined) {
        await refreshStaleSelection(selection.sessionID)
        return
      }
    } catch (error) {
      log("[btw-side] Failed to validate picker selection", {
        sessionID: selection.sessionID,
        error,
      })
      await refreshStaleSelection(selection.sessionID)
      return
    }
    args.api.ui.dialog.clear()
    args.api.route.navigate("session", {
      sessionID: selection.sessionID,
    })
  }

  args.api.ui.dialog.replace(() =>
    args.api.ui.DialogSelect<string>({
      title: "BTW conversations",
      placeholder: "Choose Main, a retained BTW, or New BTW",
      options: picker.options,
      current: picker.current,
      onSelect: (option) => select(option.value),
    }),
  )
  return true
}
