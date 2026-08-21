import type {
  TuiHostSlotMap,
  TuiPluginApi,
  TuiPromptRef,
  TuiSlotContext,
} from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import { getBtwSideMetadata } from "./metadata"
import { createBtwAdoptionCache } from "./tui-adoption-cache"
import { createBtwAdoptionGuard } from "./tui-adoption-guard"
import { createBtwParentValidator } from "./tui-parent-validator"
import {
  createBtwSideController,
} from "./tui-controller"
import { parseBtwQuestion } from "./btw-command-draft"
import { registerBtwSideKeymap } from "./tui-keymap"
import { openBtwPicker } from "./tui-picker"
import {
  adaptTuiPromptRef,
  createBtwControllerDependencies,
  currentTuiSessionID,
  isCurrentTuiSession,
  parentTuiStatusLabel,
  unwrapTuiData,
} from "./tui-session-bridge"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (
    parent: Node,
    child: unknown,
    marker?: unknown,
    initial?: unknown,
  ) => unknown
  readonly setProp: (
    node: Node,
    name: string,
    value: unknown,
    previous?: unknown,
  ) => unknown
}

export async function registerBtwSideTui<Node>(
  api: TuiPluginApi,
  solid: SolidRuntime<Node>,
): Promise<void> {
  log("[btw-side] TUI registration started")
  const promptRefs = new Map<string, TuiPromptRef>()
  const adoptionCache = createBtwAdoptionCache()
  const adoptionRequests = new Map<string, Promise<void>>()
  const reattachingSessions = new Set<string>()
  const adoptionFailures = new Set<string>()
  const controller = createBtwSideController(
    createBtwControllerDependencies(api),
  )
  const adoptionGuard = createBtwAdoptionGuard(() =>
    currentTuiSessionID(api),
  )
  const parentValidator = createBtwParentValidator({
    fetchStatus: async (sessionID) => {
      try {
        const response = await api.client.session.get({
          sessionID,
          directory: api.state.path.directory,
        })
        if (response.error !== undefined) return "retry"
        return response.data !== undefined ? "exists" : "missing"
      } catch (error) {
        log("[btw-side] Failed to validate parent session", {
          sessionID,
          error,
        })
        return "retry"
      }
    },
  })

  async function adoptValidatedMetadata(
    sessionID: string,
    parentSessionID: string,
  ): Promise<void> {
    if (!adoptionGuard.canApply(sessionID, parentSessionID)) return
    if (!(await parentValidator.exists(parentSessionID))) return
    if (!adoptionGuard.canApply(sessionID, parentSessionID)) return
    controller.adopt(parentSessionID, sessionID)
    api.renderer.requestRender()
    log("[btw-side] TUI adopted side session", {
      sessionID,
      parentSessionID,
    })
  }

  function adoptSideSession(sessionID: string): Promise<void> | undefined {
    const pending = adoptionRequests.get(sessionID)
    if (pending) return pending
    const cached = adoptionCache.read(sessionID)
    if (cached.hydrated) {
      if (!cached.metadata) return
      const request = adoptValidatedMetadata(
        sessionID,
        cached.metadata.parent_session_id,
      ).finally(() => {
        adoptionRequests.delete(sessionID)
      })
      adoptionRequests.set(sessionID, request)
      return request
    }
    reattachingSessions.add(sessionID)
    adoptionFailures.delete(sessionID)
    api.renderer.requestRender()
    const request = (async (): Promise<void> => {
      try {
        const localSession = api.state.session.get(sessionID)
        const session = getBtwSideMetadata(localSession)
          ? localSession
          : unwrapTuiData(
              await api.client.session.get({
                sessionID,
                directory: api.state.path.directory,
              }),
              "Unable to read BTW session metadata",
            )
        const metadata = getBtwSideMetadata(session)
        if (!adoptionGuard.canApply(sessionID)) return
        adoptionCache.write(sessionID, metadata)
        if (!metadata) return
        await adoptValidatedMetadata(
          sessionID,
          metadata.parent_session_id,
        )
      } catch (error) {
        if (adoptionGuard.canApply(sessionID)) {
          adoptionFailures.add(sessionID)
        }
        log("[btw-side] Failed to adopt side session", {
          sessionID,
          error,
        })
      } finally {
        reattachingSessions.delete(sessionID)
        adoptionRequests.delete(sessionID)
        api.renderer.requestRender()
      }
    })()
    adoptionRequests.set(sessionID, request)
    return request
  }

  function activePromptRef(): TuiPromptRef | undefined {
    const sessionID = currentTuiSessionID(api)
    return sessionID ? promptRefs.get(sessionID) : undefined
  }

  async function openBtw(): Promise<void> {
    log("[btw-side] TUI open command invoked")
    const sessionID = currentTuiSessionID(api)
    if (sessionID) await adoptSideSession(sessionID)
    if (!isCurrentTuiSession(api, sessionID)) return
    if (sessionID && adoptionFailures.has(sessionID)) {
      api.ui.toast({
        variant: "warning",
        message: "Unable to verify whether this is a BTW conversation.",
      })
      return
    }
    const promptRef = activePromptRef()
    if (!promptRef) {
      api.ui.toast({
        variant: "warning",
        message: "BTW is unavailable before the session starts.",
      })
      return
    }
    const originalInput = promptRef.current.input
    const parsed = parseBtwQuestion(originalInput)
    if (parsed.consumeDraft && parsed.question.length > 0) {
      await controller.startFromPrompt(adaptTuiPromptRef(promptRef))
      return
    }
    const opened = await openBtwPicker({
      api,
      controller,
      activePromptRef,
    })
    if (
      opened &&
      parsed.consumeDraft &&
      promptRef.current.input === originalInput
    ) {
      promptRef.set({
        ...promptRef.current,
        input: "",
      })
    }
  }

  const showBtwPicker = async (): Promise<void> => {
    await openBtwPicker({
      api,
      controller,
      activePromptRef,
    })
  }

  const unregisterSlashCommand =
    api.command?.register(() => [
      {
        title: "BTW side conversation",
        value: "omo.btw.slash",
        description:
          "Start or switch retained side conversations without interrupting the main turn",
        category: "Session",
        enabled: true,
        slash: {
          name: "btw",
          aliases: ["side"],
        },
        onSelect: openBtw,
      },
    ]) ?? (() => undefined)

  const keymapRegistration = registerBtwSideKeymap({
    api,
    controller,
    activePromptRef,
    openBtw,
    openPicker: showBtwPicker,
    isCurrentSideIdle: () => {
      const sessionID = currentTuiSessionID(api)
      return (
        sessionID !== undefined &&
        controller.side(sessionID) !== undefined &&
        api.state.session.status(sessionID)?.type !== "busy" &&
        api.state.session.permission(sessionID).length === 0 &&
        api.state.session.question(sessionID).length === 0
      )
    },
    returnToParent: controller.returnToParent,
  })

  api.slots.register({
    order: 950,
    slots: {
      session_prompt: (
        _context: TuiSlotContext,
        value: TuiHostSlotMap["session_prompt"],
      ) =>
        api.ui.Prompt({
          sessionID: value.session_id,
          visible: value.visible,
          disabled: value.disabled,
          onSubmit: value.on_submit,
          ref: (promptRef) => {
            value.ref?.(promptRef)
            if (promptRef) {
              keymapRegistration.resetEscapeSequence()
              promptRefs.set(value.session_id, promptRef)
              log("[btw-side] TUI prompt ref attached", {
                sessionID: value.session_id,
              })
              controller.attachPromptRef(
                value.session_id,
                adaptTuiPromptRef(promptRef),
              )
              void (async () => {
                await controller.handleNavigation(value.session_id)
                const state = controller.state()
                const isRelated =
                  state.phase === "creating"
                    ? value.session_id === state.parentSessionID
                    : state.phase === "open" ||
                        state.phase === "closing"
                      ? value.session_id === state.parentSessionID ||
                        value.session_id === state.sideSessionID
                      : false
                if (isRelated) return
                if (state.phase === "closing") {
                  await controller.waitUntilClosed()
                }
                if (currentTuiSessionID(api) === value.session_id) {
                  await adoptSideSession(value.session_id)
                }
              })()
              return
            }
            keymapRegistration.resetEscapeSequence()
            promptRefs.delete(value.session_id)
            controller.attachPromptRef(value.session_id, undefined)
            void controller.handleNavigation(
              currentTuiSessionID(api) ?? "",
            )
          },
          right: api.ui.Slot({
            name: "session_prompt_right",
            session_id: value.session_id,
          }),
        }),
      session_prompt_right: (
        _context: TuiSlotContext,
        value: TuiHostSlotMap["session_prompt_right"],
      ) => {
        const state = controller.state()
        let label: string | undefined
        if (
          state.phase === "creating" &&
          value.session_id === state.parentSessionID
        ) {
          label = "BTW starting..."
        } else if (
          state.phase === "open" &&
          value.session_id === state.parentSessionID
        ) {
          label = "BTW retained · ctrl+/ picker"
        } else if (
          state.phase === "open" &&
          value.session_id === state.sideSessionID
        ) {
          const sideNumber = controller.sideNumber(state.sideSessionID)
          const sideLabel =
            sideNumber === undefined ? "BTW side" : `BTW #${sideNumber}`
          label = `${sideLabel} · ${parentTuiStatusLabel(api, state.parentSessionID)} · esc esc return · ctrl+/ picker · ctrl+c delete`
        } else if (
          state.phase === "closing" &&
          value.session_id === state.sideSessionID
        ) {
          label = "BTW closing..."
        } else if (
          state.phase === "closed" &&
          reattachingSessions.has(value.session_id)
        ) {
          label = "BTW from main · reattaching..."
        }
        if (!label) return null
        const text = solid.createElement("text")
        solid.setProp(text, "fg", api.theme.current.textMuted)
        solid.insert(text, label)
        return text
      },
    },
  })

  const unsubscribeDeleted = api.event.on("session.deleted", (event) => {
    adoptionGuard.markDeleted(event.properties.info.id)
    adoptionCache.removeForDeletion(event.properties.info.id)
    parentValidator.markDeleted(event.properties.info.id)
    controller.handleSessionDeleted(event.properties.info.id)
  })

  api.lifecycle.onDispose(async () => {
    adoptionGuard.dispose()
    unregisterSlashCommand()
    for (const unregister of keymapRegistration.unregister) unregister()
    unsubscribeDeleted()
    await controller.dispose()
  })

  log("[btw-side] TUI controls registered")
}
