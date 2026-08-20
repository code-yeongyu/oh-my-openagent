import type {
  BtwPromptRef,
  BtwSideControllerDependencies,
  BtwSideState,
} from "./tui-controller-types"
import {
  abortBtwSide,
  deleteBtwSide,
} from "./tui-side-removal"
import { createBtwPromptQueue } from "./tui-prompt-queue"
import { prepareBtwSideStart } from "./tui-side-start"

const MAX_DELETED_SESSION_TOMBSTONES = 512

export function createBtwSideController(
  dependencies: BtwSideControllerDependencies,
) {
  let currentState: BtwSideState = { phase: "closed" }
  let stateGeneration = 0
  let disposed = false
  let skipClosingParentNavigation = false
  const activeCreationOperations = new Set<{
    generation: number
    finished: Promise<void>
    restoreDraftIfUnchanged: () => void
  }>()
  const closedWaiters = new Set<() => void>()
  const deletedSessionIDs = new Set<string>()
  const promptQueue = createBtwPromptQueue()

  function rememberDeletedSession(sessionID: string): void {
    if (
      !deletedSessionIDs.has(sessionID) &&
      deletedSessionIDs.size >= MAX_DELETED_SESSION_TOMBSTONES
    ) {
      const oldestSessionID = deletedSessionIDs.values().next().value
      if (oldestSessionID !== undefined) {
        deletedSessionIDs.delete(oldestSessionID)
      }
    }
    deletedSessionIDs.add(sessionID)
  }

  function setState(nextState: BtwSideState): void {
    currentState = nextState
    stateGeneration += 1
    if (nextState.phase === "closed") {
      for (const resolve of closedWaiters) resolve()
      closedWaiters.clear()
    }
    if (!disposed) dependencies.requestRender()
  }

  function waitUntilClosed(): Promise<void> {
    if (currentState.phase === "closed") return Promise.resolve()
    return new Promise((resolve) => {
      closedWaiters.add(resolve)
    })
  }

  function isClosingGeneration(generation: number): boolean {
    return (
      stateGeneration === generation &&
      currentState.phase === "closing"
    )
  }

  function isCreatingGeneration(generation: number): boolean {
    return (
      stateGeneration === generation &&
      currentState.phase === "creating"
    )
  }

  function attachPromptRef(sessionID: string, promptRef: BtwPromptRef | undefined): void {
    promptQueue.attach(sessionID, promptRef)
  }

  async function startFromPrompt(promptRef: BtwPromptRef): Promise<void> {
    if (disposed) return
    if (currentState.phase !== "closed") {
      dependencies.showToast(
        currentState.phase === "creating"
          ? "BTW is already starting."
          : "A BTW conversation is already open.",
      )
      return
    }

    const prepared = prepareBtwSideStart(dependencies, promptRef)
    if (!prepared) return
    const restoreDraftIfUnchanged = (): void => {
      if (prepared.consumeDraft && promptRef.input.length === 0) {
        promptRef.set(prepared.originalDraft)
      }
    }
    if (prepared.consumeDraft) promptRef.set("")
    setState({
      phase: "creating",
      parentSessionID: prepared.parentSessionID,
    })
    const creatingGeneration = stateGeneration
    let resolveCreationFinished!: () => void
    const creationFinished = new Promise<void>((resolve) => {
      resolveCreationFinished = resolve
    })
    const creationOperation = {
      generation: creatingGeneration,
      finished: creationFinished,
      restoreDraftIfUnchanged,
    }
    activeCreationOperations.add(creationOperation)

    try {
      const sideSession = await dependencies.createSession(prepared.createInput)
      if (deletedSessionIDs.delete(sideSession.id)) {
        if (!disposed) restoreDraftIfUnchanged()
        if (isCreatingGeneration(creatingGeneration)) {
          setState({ phase: "closed" })
        }
        return
      }
      if (disposed || !isCreatingGeneration(creatingGeneration)) {
        if (disposed) {
          setState({ phase: "closed" })
        } else {
          restoreDraftIfUnchanged()
        }
        try {
          await dependencies.deleteSession(sideSession.id)
        } catch {
          dependencies.showToast("Unable to remove cancelled BTW.")
        }
        return
      }
      if (prepared.question.length > 0) {
        promptQueue.queue(sideSession.id, prepared.question)
      }
      setState({
        phase: "open",
        parentSessionID: prepared.parentSessionID,
        sideSessionID: sideSession.id,
        owned: true,
      })
      dependencies.navigateSession(sideSession.id)
    } catch {
      if (disposed) {
        setState({ phase: "closed" })
        return
      }
      if (!isCreatingGeneration(creatingGeneration)) {
        restoreDraftIfUnchanged()
        return
      }
      restoreDraftIfUnchanged()
      setState({ phase: "closed" })
      dependencies.showToast("Unable to start BTW.")
    } finally {
      activeCreationOperations.delete(creationOperation)
      resolveCreationFinished()
    }
  }

  function toggle(): void {
    if (currentState.phase !== "open") return
    const currentSessionID = dependencies.getCurrentSessionID()
    if (currentSessionID === currentState.sideSessionID) {
      dependencies.navigateSession(currentState.parentSessionID)
      return
    }
    if (currentSessionID === currentState.parentSessionID) {
      dependencies.navigateSession(currentState.sideSessionID)
    }
  }

  async function close(): Promise<void> {
    if (currentState.phase !== "open") return
    const openState = currentState
    skipClosingParentNavigation = false
    const closingState = {
      phase: "closing",
      parentSessionID: openState.parentSessionID,
      sideSessionID: openState.sideSessionID,
      owned: openState.owned,
    } as const
    setState(closingState)
    const closingGeneration = stateGeneration
    await abortBtwSide({
      sessionID: openState.sideSessionID,
      abortSession: dependencies.abortSession,
      showToast: dependencies.showToast,
    })
    if (!isClosingGeneration(closingGeneration)) return
    if (!skipClosingParentNavigation) {
      dependencies.navigateSession(openState.parentSessionID)
    }
    const deleted = await deleteBtwSide({
      sessionID: openState.sideSessionID,
      deleteSession: dependencies.deleteSession,
      showToast: () => undefined,
      failureMessage: "Unable to close BTW.",
    })
    if (!isClosingGeneration(closingGeneration)) return
    if (!deleted) {
      promptQueue.clear(openState.sideSessionID)
      setState({ phase: "closed" })
      dependencies.showToast(
        "Unable to delete BTW. Delete the abandoned side session manually.",
      )
      return
    }
    promptQueue.clear(openState.sideSessionID)
    setState({ phase: "closed" })
  }

  async function handleNavigation(sessionID: string): Promise<void> {
    if (currentState.phase === "creating") {
      if (sessionID !== currentState.parentSessionID) {
        const creatingGeneration = stateGeneration
        for (const operation of activeCreationOperations) {
          if (operation.generation === creatingGeneration) {
            operation.restoreDraftIfUnchanged()
          }
        }
        setState({ phase: "closed" })
      }
      return
    }
    if (currentState.phase === "closing") {
      if (
        sessionID !== currentState.parentSessionID &&
        sessionID !== currentState.sideSessionID
      ) {
        skipClosingParentNavigation = true
      }
      return
    }
    if (currentState.phase !== "open") return
    if (
      sessionID === currentState.parentSessionID ||
      sessionID === currentState.sideSessionID
    ) {
      return
    }
    const openState = currentState
    setState({
      phase: "closing",
      parentSessionID: openState.parentSessionID,
      sideSessionID: openState.sideSessionID,
      owned: openState.owned,
    })
    const closingGeneration = stateGeneration
    if (openState.owned) {
      await abortBtwSide({
        sessionID: openState.sideSessionID,
        abortSession: dependencies.abortSession,
        showToast: dependencies.showToast,
      })
      if (!isClosingGeneration(closingGeneration)) return
      await deleteBtwSide({
        sessionID: openState.sideSessionID,
        deleteSession: dependencies.deleteSession,
        showToast: dependencies.showToast,
        failureMessage: "Unable to discard BTW.",
      })
      if (!isClosingGeneration(closingGeneration)) return
    }
    if (!isClosingGeneration(closingGeneration)) return
    promptQueue.clear(openState.sideSessionID)
    setState({ phase: "closed" })
  }

  function handleSessionDeleted(sessionID: string): void {
    rememberDeletedSession(sessionID)
    if (currentState.phase === "creating") {
      if (sessionID === currentState.parentSessionID) {
        setState({ phase: "closed" })
        dependencies.showToast(
          "BTW cancelled because its main session was deleted.",
        )
      }
      return
    }
    if (
      currentState.phase === "closing" &&
      sessionID === currentState.parentSessionID
    ) {
      skipClosingParentNavigation = true
      return
    }
    if (
      currentState.phase !== "open" &&
      currentState.phase !== "closing"
    ) {
      return
    }
    if (sessionID === currentState.sideSessionID) {
      const parentSessionID = currentState.parentSessionID
      promptQueue.clear(currentState.sideSessionID)
      setState({ phase: "closed" })
      if (dependencies.getCurrentSessionID() === sessionID) {
        dependencies.navigateSession(parentSessionID)
      }
      return
    }
    if (sessionID === currentState.parentSessionID) {
      const sideSessionID = currentState.sideSessionID
      promptQueue.clear(sideSessionID)
      setState({ phase: "closed" })
      if (dependencies.getCurrentSessionID() === sessionID) {
        dependencies.navigateSession(sideSessionID)
      }
      dependencies.showToast(
        "BTW detached because its main session was deleted.",
      )
    }
  }

  function canCloseCurrentSide(): boolean {
    if (currentState.phase !== "open") return false
    if (dependencies.getCurrentSessionID() !== currentState.sideSessionID) {
      return false
    }
    return (
      promptQueue.input(currentState.sideSessionID).length === 0 &&
      !promptQueue.hasAttachments(currentState.sideSessionID)
    )
  }

  function adopt(parentSessionID: string, sideSessionID: string): void {
    if (currentState.phase !== "closed") return
    setState({
      phase: "open",
      parentSessionID,
      sideSessionID,
      owned: false,
    })
  }

  return {
    state: (): BtwSideState => currentState,
    startFromPrompt,
    attachPromptRef,
    toggle,
    close,
    handleNavigation,
    handleSessionDeleted,
    canCloseCurrentSide,
    adopt,
    waitUntilClosed,
    dispose: async (): Promise<void> => {
      disposed = true
      const pendingCreations = [...activeCreationOperations].map(
        (operation) => operation.finished,
      )
      if (currentState.phase === "creating") {
        setState({ phase: "closed" })
      } else if (currentState.phase === "closing") {
        skipClosingParentNavigation = true
        await waitUntilClosed()
      } else if (currentState.phase === "open" && currentState.owned) {
        await handleNavigation("")
      } else if (currentState.phase === "open") {
        setState({ phase: "closed" })
      }
      await Promise.all(pendingCreations)
    },
  }
}
