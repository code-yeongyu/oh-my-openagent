import type {
  BtwPromptRef,
  BtwSideControllerDependencies,
  BtwSideRecord,
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
  const retainedSides = new Map<string, BtwSideRecord>()
  const sideNumbers = new Map<string, number>()
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

  function latestSideForParent(parentSessionID: string): BtwSideRecord | undefined {
    return [...retainedSides.values()]
      .reverse()
      .find((side) => side.parentSessionID === parentSessionID)
  }

  function stateForSession(sessionID: string | undefined): BtwSideState {
    if (!sessionID) return { phase: "closed" }
    const side = retainedSides.get(sessionID)
    if (side) {
      return {
        phase: "open",
        ...side,
      }
    }
    const retained = latestSideForParent(sessionID)
    return retained
      ? {
          phase: "open",
          ...retained,
        }
      : { phase: "closed" }
  }

  function rootParentForCurrentSession(): string | undefined {
    const currentSessionID = dependencies.getCurrentSessionID()
    if (!currentSessionID) return undefined
    return retainedSides.get(currentSessionID)?.parentSessionID
      ?? currentSessionID
  }

  async function startFromPrompt(
    promptRef: BtwPromptRef,
    parentSessionID = rootParentForCurrentSession(),
  ): Promise<boolean> {
    if (disposed) return false
    if (
      currentState.phase === "creating" ||
      currentState.phase === "closing"
    ) {
      dependencies.showToast(
        currentState.phase === "creating"
          ? "BTW is already starting."
          : "BTW is still closing.",
      )
      return false
    }

    const previousState = currentState
    const prepared = prepareBtwSideStart(
      dependencies,
      promptRef,
      parentSessionID,
    )
    if (!prepared) return false
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
          setState(previousState)
        }
        return false
      }
      if (disposed || !isCreatingGeneration(creatingGeneration)) {
        if (disposed) {
          setState({ phase: "closed" })
        } else {
          restoreDraftIfUnchanged()
          setState(previousState)
        }
        try {
          await dependencies.deleteSession(sideSession.id)
        } catch {
          dependencies.showToast("Unable to remove cancelled BTW.")
        }
        return false
      }
      if (prepared.question.length > 0) {
        promptQueue.queue(sideSession.id, prepared.question)
      }
      const retainedSide: BtwSideRecord = {
        parentSessionID: prepared.parentSessionID,
        sideSessionID: sideSession.id,
        owned: true,
      }
      retainedSides.set(sideSession.id, retainedSide)
      setState({
        phase: "open",
        ...retainedSide,
      })
      dependencies.navigateSession(sideSession.id)
      return true
    } catch {
      if (disposed) {
        setState({ phase: "closed" })
        return false
      }
      if (!isCreatingGeneration(creatingGeneration)) {
        restoreDraftIfUnchanged()
        return false
      }
      restoreDraftIfUnchanged()
      setState(previousState)
      dependencies.showToast("Unable to start BTW.")
      return false
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
    const currentSessionID = dependencies.getCurrentSessionID()
    const openState = currentSessionID
      ? retainedSides.get(currentSessionID)
      : undefined
    if (!openState) return
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
      setState(stateForSession(openState.parentSessionID))
      dependencies.showToast(
        "Unable to delete BTW. Delete the abandoned side session manually.",
      )
      return
    }
    retainedSides.delete(openState.sideSessionID)
    sideNumbers.delete(openState.sideSessionID)
    promptQueue.clear(openState.sideSessionID)
    setState({ phase: "closed" })
    setState(stateForSession(openState.parentSessionID))
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
        setState(stateForSession(sessionID))
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
    setState(stateForSession(sessionID))
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
    const deletedSide = retainedSides.get(sessionID)
    if (deletedSide) {
      retainedSides.delete(sessionID)
      sideNumbers.delete(sessionID)
      promptQueue.clear(sessionID)
      if (dependencies.getCurrentSessionID() === sessionID) {
        dependencies.navigateSession(deletedSide.parentSessionID)
      }
      setState(stateForSession(deletedSide.parentSessionID))
      return
    }
    const detachedSides = [...retainedSides.values()].filter(
      (side) => side.parentSessionID === sessionID,
    )
    if (detachedSides.length > 0) {
      const closingSideID =
        currentState.phase === "closing" &&
        sessionID === currentState.parentSessionID
          ? currentState.sideSessionID
          : undefined
      for (const side of detachedSides) {
        if (side.sideSessionID === closingSideID) continue
        const sideNumber = sideNumbers.get(side.sideSessionID)
        retainedSides.delete(side.sideSessionID)
        sideNumbers.delete(side.sideSessionID)
        promptQueue.clear(side.sideSessionID)
        void deleteBtwSide({
          sessionID: side.sideSessionID,
          deleteSession: dependencies.deleteSession,
          showToast: dependencies.showToast,
          failureMessage:
            "Unable to delete BTW after Main was removed. Delete the abandoned side session manually.",
        }).then((deleted) => {
          if (deleted || disposed) return
          retainedSides.set(side.sideSessionID, side)
          if (sideNumber !== undefined) {
            sideNumbers.set(side.sideSessionID, sideNumber)
          }
          if (
            dependencies.getCurrentSessionID() ===
            side.sideSessionID
          ) {
            setState(stateForSession(side.sideSessionID))
          }
        })
      }
      if (closingSideID) {
        skipClosingParentNavigation = true
      } else {
        setState({ phase: "closed" })
      }
      dependencies.showToast(
        "BTW detached because its main session was deleted.",
      )
    }
  }

  function canCloseCurrentSide(): boolean {
    const currentSessionID = dependencies.getCurrentSessionID()
    const currentSide = currentSessionID
      ? retainedSides.get(currentSessionID)
      : undefined
    if (!currentSide) return false
    return (
      promptQueue.input(currentSide.sideSessionID).length === 0 &&
      !promptQueue.hasAttachments(currentSide.sideSessionID)
    )
  }

  function adopt(
    parentSessionID: string,
    sideSessionID: string,
    sideNumber?: number,
  ): void {
    const retainedSide: BtwSideRecord = {
      parentSessionID,
      sideSessionID,
      owned: false,
    }
    retainedSides.set(sideSessionID, retainedSide)
    if (sideNumber !== undefined) {
      sideNumbers.set(sideSessionID, sideNumber)
    }
    if (dependencies.getCurrentSessionID() === sideSessionID) {
      setState({
        phase: "open",
        ...retainedSide,
      })
    }
  }

  function returnToParent(): void {
    const currentSessionID = dependencies.getCurrentSessionID()
    const currentSide = currentSessionID
      ? retainedSides.get(currentSessionID)
      : undefined
    if (!currentSide) return
    dependencies.navigateSession(currentSide.parentSessionID)
    setState({
      phase: "open",
      ...currentSide,
    })
  }

  return {
    state: (): BtwSideState => currentState,
    sides: (): BtwSideRecord[] => [...retainedSides.values()],
    side: (sessionID: string): BtwSideRecord | undefined =>
      retainedSides.get(sessionID),
    sideNumber: (sessionID: string): number | undefined =>
      sideNumbers.get(sessionID),
    rootParent: (sessionID: string): string =>
      retainedSides.get(sessionID)?.parentSessionID ?? sessionID,
    startFromPrompt,
    attachPromptRef,
    toggle,
    close,
    returnToParent,
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
        setState({ phase: "closed" })
      } else if (currentState.phase === "open") {
        setState({ phase: "closed" })
      }
      await Promise.all(pendingCreations)
    },
  }
}
