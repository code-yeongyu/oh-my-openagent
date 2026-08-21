import { describe, expect, it, mock } from "bun:test"

import { BTW_SIDE_METADATA_KEY } from "./metadata"
import { createBtwSideController } from "./tui-controller"
import type {
  BtwPromptRef,
  BtwSideControllerDependencies,
} from "./tui-controller-types"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createPromptRef(input: string, hasAttachments = false): BtwPromptRef & {
  readonly hasAttachments: boolean
  readonly submitted: () => number
} {
  let currentInput = input
  let submitCount = 0
  return {
    hasAttachments,
    get input() {
      return currentInput
    },
    set(nextInput) {
      currentInput = nextInput
    },
    submit() {
      submitCount += 1
    },
    submitted: () => submitCount,
  }
}

function createHarness(overrides?: Partial<BtwSideControllerDependencies>) {
  let currentSessionID = "ses_parent"
  const navigations: string[] = []
  const deleted: string[] = []
  const aborted: string[] = []
  const toasts: string[] = []
  const parentSession = {
    id: "ses_parent",
    title: "Implement BTW",
    agent: "sisyphus",
    model: {
      providerID: "openai",
      id: "gpt-5.4",
    },
  }
  const parentMessages = [
    {
      info: {
        id: "msg_parent_user",
        role: "user" as const,
      },
    },
    {
      info: {
        id: "msg_parent_done",
        role: "assistant" as const,
        time: {
          completed: 2,
        },
      },
    },
    {
      info: {
        id: "msg_parent_partial",
        role: "assistant" as const,
        time: {},
      },
    },
  ]
  const createSession = mock(async () => ({
    id: "ses_side",
    title: "BTW · Implement BTW",
  }))
  const dependencies: BtwSideControllerDependencies = {
    getCurrentSessionID: () => currentSessionID,
    getSession: (sessionID) =>
      sessionID === parentSession.id ? parentSession : undefined,
    getMessages: (sessionID) =>
      sessionID === parentSession.id ? parentMessages : [],
    createSession,
    navigateSession: (sessionID) => {
      currentSessionID = sessionID
      navigations.push(sessionID)
    },
    abortSession: async (sessionID) => {
      aborted.push(sessionID)
    },
    deleteSession: async (sessionID) => {
      deleted.push(sessionID)
    },
    showToast: (message) => {
      toasts.push(message)
    },
    requestRender: () => undefined,
    ...overrides,
  }
  const controller = createBtwSideController(dependencies)
  return {
    controller,
    createSession,
    navigations,
    deleted,
    aborted,
    toasts,
    currentSessionID: () => currentSessionID,
  }
}

describe("createBtwSideController", () => {
  it("#given an inline BTW draft #when the side prompt mounts #then only the empty temporary side receives the question", async () => {
    // given
    const harness = createHarness()
    const parentPrompt = createPromptRef("/btw what changed?")
    const sidePrompt = createPromptRef("")

    // when
    await harness.controller.startFromPrompt(parentPrompt)
    harness.controller.attachPromptRef("ses_side", sidePrompt)

    // then
    expect(harness.createSession).toHaveBeenCalledTimes(1)
    expect(harness.createSession.mock.calls[0]?.[0]).toMatchObject({
      title: "BTW · what changed?",
      agent: "sisyphus",
      model: {
        providerID: "openai",
        id: "gpt-5.4",
      },
      metadata: {
        [BTW_SIDE_METADATA_KEY]: {
          version: 1,
          parent_session_id: "ses_parent",
          boundary_message_id: "msg_parent_done",
        },
      },
    })
    expect(parentPrompt.input).toBe("")
    expect(parentPrompt.submitted()).toBe(0)
    expect(sidePrompt.input).toBe("what changed?")
    expect(sidePrompt.submitted()).toBe(1)
    expect(harness.navigations).toEqual(["ses_side"])
  })

  it("#given an attachment-bearing BTW draft #when start runs #then the complete parent draft is preserved and rejected", async () => {
    // given
    const harness = createHarness()
    const parentPrompt = createPromptRef("/btw describe this image", true)

    // when
    await harness.controller.startFromPrompt(parentPrompt)

    // then
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(parentPrompt.input).toBe("/btw describe this image")
    expect(harness.navigations).toEqual([])
    expect(harness.toasts).toContain(
      "BTW supports text-only drafts. Remove attachments before starting BTW.",
    )
  })

  it("#given side creation is pending #when BTW starts twice #then only one temporary session is created", async () => {
    // given
    const created = createDeferred<{
      id: string
      title: string
    }>()
    const createSession = mock(() => created.promise)
    const harness = createHarness({ createSession })
    const firstPrompt = createPromptRef("/btw first")
    const secondPrompt = createPromptRef("/btw second")

    // when
    const firstStart = harness.controller.startFromPrompt(firstPrompt)
    const secondStart = harness.controller.startFromPrompt(secondPrompt)
    created.resolve({
      id: "ses_side",
      title: "BTW · Implement BTW",
    })
    await Promise.all([firstStart, secondStart])

    // then
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(secondPrompt.input).toBe("/btw second")
    expect(harness.toasts).toContain("BTW is already starting.")
  })

  it("#given side creation is pending #when the TUI disposes #then the late session is deleted without navigation", async () => {
    // given
    const created = createDeferred<{
      id: string
      title: string
    }>()
    const createSession = mock(() => created.promise)
    const harness = createHarness({ createSession })
    const start = harness.controller.startFromPrompt(
      createPromptRef("/btw cancelled"),
    )

    // when
    let disposed = false
    const disposal = harness.controller.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()

    // then
    expect(disposed).toBe(false)

    // when
    created.resolve({
      id: "ses_side",
      title: "BTW · Implement BTW",
    })
    await Promise.all([start, disposal])

    // then
    expect(disposed).toBe(true)
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.navigations).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given two cancelled creations remain pending #when the TUI disposes #then every late side is deleted before disposal returns", async () => {
    // given
    const firstCreated = createDeferred<{ id: string; title: string }>()
    const secondCreated = createDeferred<{ id: string; title: string }>()
    let creationIndex = 0
    const harness = createHarness({
      createSession: () => {
        creationIndex += 1
        return creationIndex === 1
          ? firstCreated.promise
          : secondCreated.promise
      },
    })
    const firstStart = harness.controller.startFromPrompt(
      createPromptRef("/btw first"),
    )
    await harness.controller.handleNavigation("ses_other")
    const secondStart = harness.controller.startFromPrompt(
      createPromptRef("/btw second"),
    )
    let disposed = false
    const disposal = harness.controller.dispose().then(() => {
      disposed = true
    })

    // when
    secondCreated.resolve({ id: "ses_side_second", title: "Second" })
    await secondStart
    await Promise.resolve()

    // then
    expect(disposed).toBe(false)
    expect(harness.deleted).toEqual(["ses_side_second"])

    // when
    firstCreated.resolve({ id: "ses_side_first", title: "First" })
    await Promise.all([firstStart, disposal])

    // then
    expect(disposed).toBe(true)
    expect(harness.deleted).toEqual([
      "ses_side_second",
      "ses_side_first",
    ])
  })

  it("#given side creation is pending #when navigation leaves the parent #then the late session is deleted without stealing focus", async () => {
    // given
    const created = createDeferred<{
      id: string
      title: string
    }>()
    const createSession = mock(() => created.promise)
    const harness = createHarness({ createSession })
    const prompt = createPromptRef("/btw cancelled by navigation")
    const start = harness.controller.startFromPrompt(prompt)

    // when
    await harness.controller.handleNavigation("ses_other")

    // then
    expect(prompt.input).toBe("/btw cancelled by navigation")

    // when
    created.resolve({
      id: "ses_side",
      title: "BTW · Implement BTW",
    })
    await start

    // then
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.navigations).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(prompt.input).toBe("/btw cancelled by navigation")
  })

  it("#given a cancelled creation #when the parent draft changes before the server replies #then late cleanup preserves the newer draft", async () => {
    // given
    const created = createDeferred<{ id: string; title: string }>()
    const harness = createHarness({
      createSession: () => created.promise,
    })
    const prompt = createPromptRef("/btw old draft")
    const start = harness.controller.startFromPrompt(prompt)
    await harness.controller.handleNavigation("ses_other")
    prompt.set("new parent draft")

    // when
    created.resolve({
      id: "ses_side",
      title: "BTW",
    })
    await start

    // then
    expect(prompt.input).toBe("new parent draft")
    expect(harness.deleted).toEqual(["ses_side"])
  })

  it("#given side creation is pending #when the parent is deleted #then the late session is deleted without stale targets", async () => {
    // given
    const created = createDeferred<{
      id: string
      title: string
    }>()
    const createSession = mock(() => created.promise)
    const harness = createHarness({ createSession })
    const prompt = createPromptRef("/btw cancelled by deletion")
    const start = harness.controller.startFromPrompt(prompt)

    // when
    harness.controller.handleSessionDeleted("ses_parent")
    created.resolve({
      id: "ses_side",
      title: "BTW · Implement BTW",
    })
    await start

    // then
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.navigations).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(prompt.input).toBe("/btw cancelled by deletion")
    expect(harness.toasts).toContain(
      "BTW cancelled because its main session was deleted.",
    )
  })

  it("#given a pending side is deleted before create resolves #when the response arrives #then the deleted route never opens", async () => {
    // given
    const created = createDeferred<{ id: string; title: string }>()
    const harness = createHarness({
      createSession: () => created.promise,
    })
    const prompt = createPromptRef("/btw deleted remotely")
    const start = harness.controller.startFromPrompt(prompt)
    harness.controller.handleSessionDeleted("ses_side")

    // when
    created.resolve({
      id: "ses_side",
      title: "BTW",
    })
    await start

    // then
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(harness.navigations).toEqual([])
    expect(harness.deleted).toEqual([])
    expect(prompt.input).toBe("/btw deleted remotely")
  })

  it("#given an active side #when toggle runs twice #then it switches parent and side without creating another session", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    expect(harness.currentSessionID()).toBe("ses_side")

    // when
    harness.controller.toggle()
    harness.controller.toggle()

    // then
    expect(harness.navigations).toEqual([
      "ses_side",
      "ses_parent",
      "ses_side",
    ])
    expect(harness.createSession).toHaveBeenCalledTimes(1)
  })

  it("#given a retained side #when a second inline BTW starts from its parent #then a distinct side receives the second question", async () => {
    // given
    let sideIndex = 0
    const createSession = mock(async () => {
      sideIndex += 1
      return {
        id: `ses_side_${sideIndex}`,
        title: `BTW ${sideIndex}`,
      }
    })
    const harness = createHarness({ createSession })
    const firstParentPrompt = createPromptRef("/btw first retained question")
    const firstSidePrompt = createPromptRef("")
    const secondParentPrompt = createPromptRef("/btw second retained question")
    const secondSidePrompt = createPromptRef("")

    // when
    await harness.controller.startFromPrompt(firstParentPrompt)
    harness.controller.attachPromptRef("ses_side_1", firstSidePrompt)
    harness.controller.toggle()
    await harness.controller.startFromPrompt(secondParentPrompt)
    harness.controller.attachPromptRef("ses_side_2", secondSidePrompt)

    // then
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(firstSidePrompt.input).toBe("first retained question")
    expect(firstSidePrompt.submitted()).toBe(1)
    expect(secondSidePrompt.input).toBe("second retained question")
    expect(secondSidePrompt.submitted()).toBe(1)
    expect(harness.navigations).toEqual([
      "ses_side_1",
      "ses_parent",
      "ses_side_2",
    ])
  })

  it("#given a visible retained side #when inline BTW starts again #then the new side is a sibling of the same parent", async () => {
    // given
    let sideIndex = 0
    const createSession = mock(async () => {
      sideIndex += 1
      return {
        id: `ses_side_${sideIndex}`,
        title: `BTW ${sideIndex}`,
      }
    })
    const harness = createHarness({ createSession })
    await harness.controller.startFromPrompt(
      createPromptRef("/btw first retained question"),
    )

    // when
    await harness.controller.startFromPrompt(
      createPromptRef("/btw sibling retained question"),
    )

    // then
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls[1]?.[0]).toMatchObject({
      metadata: {
        [BTW_SIDE_METADATA_KEY]: {
          parent_session_id: "ses_parent",
          boundary_message_id: "msg_parent_done",
        },
      },
    })
    expect(harness.navigations).toEqual([
      "ses_side_1",
      "ses_side_2",
    ])
  })

  it("#given an active side #when close runs #then it returns to the parent and deletes the side", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    await harness.controller.close()

    // then
    expect(harness.aborted).toEqual(["ses_side"])
    expect(harness.navigations).toEqual(["ses_side", "ses_parent"])
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given two retained sides #when the visible side closes #then only that side is deleted", async () => {
    // given
    let sideIndex = 0
    const harness = createHarness({
      createSession: async () => {
        sideIndex += 1
        return {
          id: `ses_side_${sideIndex}`,
          title: `BTW ${sideIndex}`,
        }
      },
    })
    await harness.controller.startFromPrompt(
      createPromptRef("/btw first retained question"),
    )
    harness.controller.toggle()
    await harness.controller.startFromPrompt(
      createPromptRef("/btw second retained question"),
    )

    // when
    await harness.controller.close()

    // then
    expect(harness.aborted).toEqual(["ses_side_2"])
    expect(harness.deleted).toEqual(["ses_side_2"])
    expect(harness.navigations).toEqual([
      "ses_side_1",
      "ses_parent",
      "ses_side_2",
      "ses_parent",
    ])
  })

  it("#given an attachment-only side composer #when close availability is checked #then Ctrl+C does not intercept the draft", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    harness.controller.attachPromptRef(
      "ses_side",
      createPromptRef("", true),
    )

    // when
    const canClose = harness.controller.canCloseCurrentSide()

    // then
    expect(canClose).toBe(false)
  })

  it("#given close is waiting on abort #when navigation leaves BTW #then cleanup does not steal focus", async () => {
    // given
    const aborted = createDeferred<void>()
    const harness = createHarness({
      abortSession: () => aborted.promise,
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    const close = harness.controller.close()

    // when
    await harness.controller.handleNavigation("ses_other")
    aborted.resolve()
    await close

    // then
    expect(harness.navigations).toEqual(["ses_side"])
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given navigation cleanup loses its closing generation #when a new side opens #then old cleanup preserves the new state", async () => {
    // given
    const aborted = createDeferred<void>()
    let creationIndex = 0
    const harness = createHarness({
      createSession: async () => {
        creationIndex += 1
        return {
          id: creationIndex === 1 ? "ses_side_old" : "ses_side_new",
          title: "BTW",
        }
      },
      abortSession: () => aborted.promise,
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw old"))
    const navigation = harness.controller.handleNavigation("ses_other")
    harness.controller.handleSessionDeleted("ses_side_old")
    await harness.controller.startFromPrompt(createPromptRef("/btw new"))

    // when
    aborted.resolve()
    await navigation

    // then
    expect(harness.controller.state()).toEqual({
      phase: "open",
      parentSessionID: "ses_parent",
      sideSessionID: "ses_side_new",
      owned: true,
    })
    expect(harness.deleted).toEqual([])
  })

  it("#given a controller transition is closing #when a consumer awaits closed #then it resolves on the exact state change", async () => {
    // given
    const aborted = createDeferred<void>()
    const harness = createHarness({
      abortSession: () => aborted.promise,
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    const close = harness.controller.close()
    let resolved = false
    const closed = harness.controller.waitUntilClosed().then(() => {
      resolved = true
    })

    // when
    await Promise.resolve()

    // then
    expect(resolved).toBe(false)

    // when
    aborted.resolve()
    await close
    await closed

    // then
    expect(resolved).toBe(true)
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given disposal occurs during close #when abort is still pending #then disposal awaits side deletion", async () => {
    // given
    const aborted = createDeferred<void>()
    const harness = createHarness({
      abortSession: () => aborted.promise,
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    const close = harness.controller.close()
    let disposed = false
    const dispose = harness.controller.dispose().then(() => {
      disposed = true
    })

    // when
    await Promise.resolve()

    // then
    expect(disposed).toBe(false)
    expect(harness.deleted).toEqual([])

    // when
    aborted.resolve()
    await close
    await dispose

    // then
    expect(disposed).toBe(true)
    expect(harness.deleted).toEqual(["ses_side"])
  })

  it("#given close is waiting on abort #when the parent is deleted #then side cleanup still finishes without stale navigation", async () => {
    // given
    const aborted = createDeferred<void>()
    const harness = createHarness({
      abortSession: () => aborted.promise,
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))
    const close = harness.controller.close()

    // when
    harness.controller.handleSessionDeleted("ses_parent")
    aborted.resolve()
    await close

    // then
    expect(harness.navigations).toEqual(["ses_side"])
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given a retained side #when navigation opens an unrelated session #then the side remains available", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    await harness.controller.handleNavigation("ses_unrelated")

    // then
    expect(harness.aborted).toEqual([])
    expect(harness.deleted).toEqual([])
  })

  it("#given an active side is deleted externally #when the event arrives #then the parent route is restored", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    harness.controller.handleSessionDeleted("ses_side")

    // then
    expect(harness.navigations).toEqual(["ses_side", "ses_parent"])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given the parent is deleted externally #when the side is visible #then stale switching controls are detached", async () => {
    // given
    const harness = createHarness()
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    harness.controller.handleSessionDeleted("ses_parent")
    harness.controller.toggle()

    // then
    expect(harness.navigations).toEqual(["ses_side"])
    expect(harness.deleted).toEqual(["ses_side"])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(harness.toasts).toContain(
      "BTW detached because its main session was deleted.",
    )
  })

  it("#given close races an external delete #when local deletion reports failure #then closed state is not resurrected", async () => {
    // given
    const deleteStarted = createDeferred<void>()
    const deletion = createDeferred<void>()
    const harness = createHarness({
      deleteSession: async () => {
        deleteStarted.resolve()
        return deletion.promise
      },
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    const close = harness.controller.close()
    await deleteStarted.promise
    harness.controller.handleSessionDeleted("ses_side")
    deletion.reject(new Error("already deleted"))
    await close

    // then
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(harness.toasts).not.toContain("Unable to close BTW.")
  })

  it("#given side deletion fails #when close runs #then the parent remains usable and the orphan is disclosed", async () => {
    // given
    const harness = createHarness({
      deleteSession: async () => {
        throw new Error("delete failed")
      },
    })
    await harness.controller.startFromPrompt(createPromptRef("/btw"))

    // when
    await harness.controller.close()

    // then
    expect(harness.navigations).toEqual(["ses_side", "ses_parent"])
    expect(harness.controller.state()).toEqual({
      phase: "open",
      parentSessionID: "ses_parent",
      sideSessionID: "ses_side",
      owned: true,
    })
    expect(harness.controller.sides()).toEqual([
      {
        parentSessionID: "ses_parent",
        sideSessionID: "ses_side",
        owned: true,
      },
    ])
    expect(harness.toasts).toContain(
      "Unable to delete BTW. Delete the abandoned side session manually.",
    )
  })

  it("#given an adopted side #when the second TUI disposes #then it leaves the owned session intact", async () => {
    // given
    const harness = createHarness()
    harness.controller.adopt("ses_parent", "ses_side")

    // when
    await harness.controller.dispose()

    // then
    expect(harness.deleted).toEqual([])
    expect(harness.aborted).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given catalog adoption arrives out of order #when canonical numbers are supplied #then status numbering matches picker order", () => {
    // given
    const harness = createHarness()
    harness.controller.adopt("ses_parent", "ses_side_2")

    // when
    harness.controller.adopt("ses_parent", "ses_side_1", 1)
    harness.controller.adopt("ses_parent", "ses_side_2", 2)

    // then
    expect(harness.controller.sideNumber("ses_side_1")).toBe(1)
    expect(harness.controller.sideNumber("ses_side_2")).toBe(2)
  })

  it("#given a sibling remains #when close and disposal overlap #then disposal resolves after the current side closes", async () => {
    // given
    const deletion = createDeferred<void>()
    let sideIndex = 0
    const harness = createHarness({
      createSession: async () => {
        sideIndex += 1
        return {
          id: `ses_side_${sideIndex}`,
          title: `BTW ${sideIndex}`,
        }
      },
      deleteSession: async () => deletion.promise,
    })
    await harness.controller.startFromPrompt(
      createPromptRef("/btw first"),
    )
    harness.controller.toggle()
    await harness.controller.startFromPrompt(
      createPromptRef("/btw second"),
    )
    harness.controller.toggle()
    harness.controller.toggle()
    const close = harness.controller.close()
    const dispose = harness.controller.dispose()

    // when
    deletion.resolve()
    await Promise.all([close, dispose])

    // then
    expect(harness.deleted).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
  })

  it("#given side creation fails #when BTW starts #then the original parent draft is restored", async () => {
    // given
    const harness = createHarness({
      createSession: async () => {
        throw new Error("create failed")
      },
    })
    const parentPrompt = createPromptRef("/btw keep this question")

    // when
    await harness.controller.startFromPrompt(parentPrompt)

    // then
    expect(parentPrompt.input).toBe("/btw keep this question")
    expect(harness.navigations).toEqual([])
    expect(harness.controller.state()).toEqual({ phase: "closed" })
    expect(harness.toasts).toContain("Unable to start BTW.")
  })
})
