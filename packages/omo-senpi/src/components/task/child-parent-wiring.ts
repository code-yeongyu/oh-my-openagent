import {
  CANCELLED_CHILD_DIALOG,
  sharedForegroundDialogOrigins,
  type ChildDialogForwarder,
  type ForegroundDialogOrigins,
  type ForwardableDialog,
  type ForwardedAnswer,
  type ParentPermissionMode,
} from "@oh-my-opencode/senpi-task"

import type { DialogUi, SenpiExtensionAPI } from "../../extension/types"
import type { TaskRuntimeContext } from "./runtime-context"

export interface ChildParentWiringInput {
  readonly pi: Pick<SenpiExtensionAPI, "events" | "getPermissionPreset" | "sessionDialog">
  readonly runtime: Pick<TaskRuntimeContext, "ui">
  readonly labelOf: (taskId: string) => string
  readonly origins?: ForegroundDialogOrigins
}

export interface ChildParentWiring {
  readonly dialogForwarder: ChildDialogForwarder
  readonly parentPermission: ParentPermissionMode
}

const PERMISSION_PRESET_CHANGED = "permission_preset_changed"

/**
 * The parent session's side of #6189 F2d/F2e. A child's dialog is raised on the parent's UI: a foreground child's
 * inside the parent turn's own context, so the engine targets the connection that started that turn; a background
 * child's through `pi.sessionDialog`, which every attached client that may answer receives (first answer wins). The
 * parent session's teardown settles both (the engine cancels its pending dialogs) and ends the children with it.
 * An engine without `sessionDialog` cancels a background child's dialog, as before.
 */
export function createChildParentWiring(input: ChildParentWiringInput): ChildParentWiring {
  const origins = input.origins ?? sharedForegroundDialogOrigins
  const dialogForwarder: ChildDialogForwarder = {
    async forward(dialog, child) {
      const signal = child.signal
      if (signal.aborted) return CANCELLED_CHILD_DIALOG
      const title = `${input.labelOf(child.taskId)}: ${dialog.title}`
      const origin = origins.originOf(child.taskId)
      const foreground = origin === undefined ? undefined : input.runtime.ui()
      if (origin !== undefined && foreground !== undefined && canRaise(foreground, dialog)) {
        return await origin(() => raise(foreground, dialog, title, signal))
      }
      const session = input.pi.sessionDialog
      return session === undefined ? CANCELLED_CHILD_DIALOG : await raise(session, dialog, title, signal)
    },
  }
  const parentPermission: ParentPermissionMode = {
    current: () => input.pi.getPermissionPreset?.(),
    // The bus may carry other sessions' changes, so the payload is a wake-up only: the mode is read for THIS session.
    onChange: (listener) => input.pi.events?.on(PERMISSION_PRESET_CHANGED, () => {
      const preset = input.pi.getPermissionPreset?.()
      if (preset !== undefined) listener(preset)
    }) ?? (() => {}),
  }
  return { dialogForwarder, parentPermission }
}

function canRaise(ui: DialogUi, dialog: ForwardableDialog): boolean {
  return (dialog.method !== "input" || ui.input !== undefined) && (dialog.method !== "editor" || ui.editor !== undefined)
}

async function raise(ui: DialogUi, dialog: ForwardableDialog, title: string, signal: AbortSignal): Promise<ForwardedAnswer> {
  const opts = {
    signal,
    ...("timeout" in dialog && dialog.timeout !== undefined ? { timeout: dialog.timeout } : {}),
    ...("toolCallId" in dialog && dialog.toolCallId !== undefined ? { toolCallId: dialog.toolCallId } : {}),
    ...("parentToolCallId" in dialog && dialog.parentToolCallId !== undefined ? { parentToolCallId: dialog.parentToolCallId } : {}),
  }
  const text = (value: string | undefined): ForwardedAnswer => (value === undefined ? CANCELLED_CHILD_DIALOG : { kind: "value", value })
  switch (dialog.method) {
    case "select":
      return text(await ui.select(title, [...dialog.options], opts))
    case "confirm":
      return { kind: "confirmed", confirmed: await ui.confirm(title, dialog.message, opts) }
    case "input":
      return ui.input === undefined ? CANCELLED_CHILD_DIALOG : text(await ui.input(title, dialog.placeholder, opts))
    case "editor":
      return ui.editor === undefined ? CANCELLED_CHILD_DIALOG : text(await ui.editor(title, dialog.prefill, opts))
  }
}
