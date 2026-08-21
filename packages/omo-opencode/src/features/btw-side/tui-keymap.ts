import type {
  KeyEvent,
  TuiPluginApi,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui"
import type { KeyInputContext } from "@opentui/keymap"

import { log } from "../../shared/logger"
import { isBtwCommandDraft } from "./btw-command-draft"
import type { createBtwSideController } from "./tui-controller"
import { createBtwEscapeReturn } from "./tui-escape-return"

type BtwSideController = ReturnType<typeof createBtwSideController>

function isBtwPickerKey(event: KeyEvent): boolean {
  return (
    event.eventType === "press" &&
    event.ctrl &&
    (event.name === "/" || event.name === "_" || event.name === "7")
  )
}

export type BtwSideKeymapRegistration = {
  unregister: Array<() => void>
  resetEscapeSequence: () => void
}

export function registerBtwSideKeymap(args: {
  api: TuiPluginApi
  controller: BtwSideController
  activePromptRef: () => TuiPromptRef | undefined
  openBtw: () => Promise<void>
  openPicker: () => Promise<void>
  isCurrentSideIdle: () => boolean
  returnToParent: () => void
}): BtwSideKeymapRegistration {
  const escapeReturn = createBtwEscapeReturn({
    isCurrentSideIdle: args.isCurrentSideIdle,
    isDialogOpen: () => args.api.ui.dialog?.open ?? false,
    clearPending: () => args.api.keymap.clearPendingSequence(),
    returnToParent: args.returnToParent,
  })
  let shortcutOpening = false
  const openPickerFromShortcut = (name: string): void => {
    if (shortcutOpening) return
    shortcutOpening = true
    log("[btw-side] Picker keyboard shortcut intercepted", {
      name,
    })
    escapeReturn.reset()
    args.api.keymap.clearPendingSequence?.()
    void args.openPicker()
      .catch((error) => {
        log("[btw-side] Failed to open picker from keyboard shortcut", {
          error,
        })
        args.api.ui.toast({
          variant: "error",
          message: "Unable to open BTW conversations.",
        })
      })
      .finally(() => {
        shortcutOpening = false
      })
  }
  const interceptKey = (context: KeyInputContext<KeyEvent>): void => {
    if (isBtwPickerKey(context.event)) {
      context.consume({
        preventDefault: true,
        stopPropagation: true,
      })
      openPickerFromShortcut(context.event.name)
      return
    }
    escapeReturn.handle(context)
  }
  const internalKeyInput = args.api.renderer?._internalKeyInput
  // OpenTUI runs these global listeners before focused Prompt key bindings.
  // Keep the keymap interceptor below as a fallback when this hook is absent.
  const handleGlobalKeypress = (event: KeyEvent): void => {
    interceptKey({
      event,
      setData: () => undefined,
      getData: () => undefined,
      consume: (options) => {
        if (options?.preventDefault !== false) event.preventDefault()
        if (options?.stopPropagation !== false) event.stopPropagation()
      },
    })
  }
  internalKeyInput?.prependListener?.(
    "keypress",
    handleGlobalKeypress,
  )
  const unregisterGlobalKeypress = (): void => {
    internalKeyInput?.off?.("keypress", handleGlobalKeypress)
  }
  const handleStdinData = (data: string | Buffer): void => {
    const sequence =
      typeof data === "string" ? data : data.toString("utf8")
    // xterm emits every Ctrl slash alias as 0x1f, which OpenTUI drops pre-keymap.
    if (sequence !== "\u001f") return
    openPickerFromShortcut("ctrl+/")
  }
  args.api.renderer?.stdin?.prependListener?.("data", handleStdinData)
  const unregisterStdinData = (): void => {
    args.api.renderer?.stdin?.off?.("data", handleStdinData)
  }
  const unregisterRawShortcut =
    args.api.keymap.intercept?.(
      "raw",
      (context) => {
        if (context.sequence !== "\u001f") return
        context.stop()
        openPickerFromShortcut("ctrl+/")
      },
      {
        priority: Number.MAX_SAFE_INTEGER,
      },
    ) ?? (() => undefined)
  const unregisterEscape = internalKeyInput
    ? () => undefined
    : (
        args.api.keymap.intercept?.(
          "key",
          interceptKey,
          {
            priority: Number.MAX_SAFE_INTEGER,
          },
        ) ?? (() => undefined)
      )
  const unregisterCommandLayer = args.api.keymap.registerLayer({
    priority: 20_000,
    commands: [
      {
        name: "omo.btw.open",
        title: "Start BTW side conversation",
        desc: "start a side conversation in an ephemeral session",
        category: "Session",
        namespace: "palette",
        enabled: true,
        run: () => args.openBtw(),
      },
      {
        name: "omo.btw.toggle",
        title: "Switch BTW conversation",
        hidden: true,
        enabled: true,
        run: () => openPickerFromShortcut("binding"),
      },
      {
        name: "omo.btw.close",
        title: "Close BTW conversation",
        hidden: true,
        enabled: () => args.controller.canCloseCurrentSide(),
        run: () => args.controller.close(),
      },
    ],
    bindings: [
      {
        key: {
          name: "_",
          ctrl: true,
        },
        cmd: "omo.btw.toggle",
      },
      {
        key: {
          name: "/",
          ctrl: true,
        },
        cmd: "omo.btw.toggle",
      },
      {
        key: {
          name: "7",
          ctrl: true,
        },
        cmd: "omo.btw.toggle",
      },
      {
        key: "ctrl+/",
        cmd: "omo.btw.toggle",
      },
      {
        key: "ctrl+_",
        cmd: "omo.btw.toggle",
      },
      {
        key: "ctrl+7",
        cmd: "omo.btw.toggle",
      },
      {
        key: "ctrl+c",
        cmd: "omo.btw.close",
        preventDefault: true,
        fallthrough: false,
      },
    ],
  })

  const unregisterInlineLayer = args.api.keymap.registerLayer({
    priority: 10_000,
    enabled: () => {
      const promptRef = args.activePromptRef()
      return promptRef ? isBtwCommandDraft(promptRef.current.input) : false
    },
    bindings: [
      {
        key: "enter,return",
        cmd: "omo.btw.open",
      },
    ],
  })

  return {
    unregister: [
      unregisterStdinData,
      unregisterGlobalKeypress,
      unregisterRawShortcut,
      unregisterEscape,
      unregisterInlineLayer,
      unregisterCommandLayer,
    ],
    resetEscapeSequence: escapeReturn.reset,
  }
}

