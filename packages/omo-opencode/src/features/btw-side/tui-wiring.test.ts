import { describe, expect, it, mock } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BTW_SIDE_METADATA_KEY } from "./metadata"
import { openBtwPicker } from "./tui-picker"
import { registerBtwSideTui } from "./tui-wiring"

type TestCommand = {
  name: string
  namespace?: string
  slashName?: string
  slashAliases?: string[]
  enabled?: boolean | (() => boolean)
  run?: () => void | Promise<void>
}

type TestLayer = {
  mode?: string
  enabled?: () => boolean
  commands?: TestCommand[]
  bindings?: Array<{
    key: string
    cmd: string
    preventDefault?: boolean
    fallthrough?: boolean
  }>
}

type TestSlashCommand = {
  title: string
  value: string
  description?: string
  category?: string
  enabled?: boolean
  slash?: {
    name: string
    aliases?: string[]
  }
  onSelect?: () => void | Promise<void>
}

type TestNode = {
  tag: string
  props: Record<string, unknown>
  children: unknown[]
}

type TestSlotRegistration = {
  slots: Record<
    string,
    (context: unknown, value: Record<string, unknown>) => unknown
  >
}

type TestDialogOption = {
  title: string
  value: unknown
  description?: string
  category?: string
  disabled?: boolean
}

type TestDialogSelectProps = {
  title: string
  options: TestDialogOption[]
  current?: unknown
  onSelect?: (option: TestDialogOption) => void | Promise<void>
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve,
  }
}

function createPickerHarness(
  promptInput = "/btw",
  parentMessages = [
    {
      id: "msg_parent",
      role: "user",
      time: {
        created: 1,
      },
    },
  ],
) {
  let routeSessionID = "ses_parent"
  let currentPromptInput = promptInput
  const layers: TestLayer[] = []
  const slots: TestSlotRegistration[] = []
  const dialogSelections: TestDialogSelectProps[] = []
  const toasts: string[] = []
  let dialogClears = 0
  const sessions = [
    {
      id: "ses_parent",
      title: "Parent",
      time: {
        created: 1,
        updated: 1,
      },
    },
    {
      id: "ses_side_1",
      title: "BTW · first retained question",
      time: {
        created: 2,
        updated: 2,
      },
      metadata: {
        [BTW_SIDE_METADATA_KEY]: {
          version: 1,
          parent_session_id: "ses_parent",
          boundary_message_id: "msg_parent",
        },
      },
    },
    {
      id: "ses_side_2",
      title: "BTW · second retained question",
      time: {
        created: 3,
        updated: 3,
      },
      metadata: {
        [BTW_SIDE_METADATA_KEY]: {
          version: 1,
          parent_session_id: "ses_parent",
          boundary_message_id: "msg_parent",
        },
      },
    },
  ]
  const listSessions = mock(async () => ({
    data: sessions,
  }))
  const createSession = mock(async () => ({
    data: {
      id: "ses_new_side",
      title: "BTW · New side",
    },
  }))
  const promptRef = {
    focused: true,
    get current() {
      return {
        input: currentPromptInput,
        parts: [],
      }
    },
    set(next: { input: string }) {
      currentPromptInput = next.input
    },
    reset: () => undefined,
    blur: () => undefined,
    focus: () => undefined,
    submit: () => undefined,
  }
  const api = unsafeTestValue({
    state: {
      path: {
        directory: "/tmp/project",
      },
      session: {
        get: (sessionID: string) =>
          sessions.find((session) => session.id === sessionID),
        messages: () => parentMessages,
        status: () => ({
          type: "idle",
        }),
        permission: () => [],
        question: () => [],
      },
    },
    client: {
      session: {
        list: listSessions,
        get: async ({ sessionID }: { sessionID: string }) => ({
          data: sessions.find((session) => session.id === sessionID),
        }),
        create: createSession,
        abort: async () => ({
          data: true,
        }),
        delete: async () => ({
          data: true,
        }),
      },
    },
    route: {
      get current() {
        return {
          name: "session",
          params: {
            sessionID: routeSessionID,
          },
        }
      },
      navigate: (_name: string, params: { sessionID: string }) => {
        routeSessionID = params.sessionID
      },
    },
    command: {
      register: () => () => undefined,
    },
    keymap: {
      registerLayer: (layer: TestLayer) => {
        layers.push(layer)
        return () => undefined
      },
      intercept: () => () => undefined,
      clearPendingSequence: () => undefined,
    },
    mode: {
      current: () => "base",
    },
    slots: {
      register: (registration: TestSlotRegistration) => {
        slots.push(registration)
        return "omo-btw-picker-slots"
      },
    },
    event: {
      on: () => () => undefined,
    },
    ui: {
      Prompt: (props: {
        ref?: (ref: typeof promptRef | undefined) => void
      }) => {
        props.ref?.(promptRef)
        return {
          tag: "prompt",
        }
      },
      DialogSelect: (props: TestDialogSelectProps) => {
        dialogSelections.push(props)
        return {
          tag: "dialog-select",
        }
      },
      Slot: () => undefined,
      toast: ({ message }: { message: string }) => {
        toasts.push(message)
      },
      dialog: {
        replace: (render: () => unknown) => {
          render()
        },
        clear: () => {
          dialogClears += 1
        },
        get open() {
          return dialogSelections.length > 0
        },
      },
    },
    theme: {
      current: {
        textMuted: "#888888",
      },
    },
    renderer: {
      requestRender: () => undefined,
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: () => () => undefined,
    },
  })
  const solid = unsafeTestValue({
    createElement: (tag: string): TestNode => ({
      tag,
      props: {},
      children: [],
    }),
    insert: (node: TestNode, child: unknown) => {
      node.children.push(child)
    },
    setProp: (node: TestNode, name: string, value: unknown) => {
      node.props[name] = value
    },
  })

  return {
    api,
    solid,
    layers,
    slots,
    dialogSelections,
    listSessions,
    createSession,
    promptRef,
    sessions,
    toasts,
    currentSessionID: () => routeSessionID,
    promptInput: () => currentPromptInput,
    dialogClears: () => dialogClears,
  }
}

describe("registerBtwSideTui", () => {
  it("#given an existing route without a prompt ref #when the picker opens #then retained sessions remain selectable", async () => {
    // given
    const harness = createPickerHarness()
    const controller = unsafeTestValue({
      adopt: () => undefined,
      startFromPrompt: async () => false,
    })

    // when
    const opened = await openBtwPicker({
      api: harness.api,
      controller,
      activePromptRef: () => undefined,
    })

    // then
    expect(opened).toBe(true)
    expect(harness.dialogSelections[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("Main"),
        }),
        expect.objectContaining({
          title: expect.stringContaining("first retained question"),
        }),
      ]),
    )
  })

  it("#given the picker opened without its parent prompt #when another route gains a prompt before New BTW #then creation stays unavailable", async () => {
    // given
    const harness = createPickerHarness()
    const startFromPrompt = mock(async () => true)
    const controller = unsafeTestValue({
      adopt: () => undefined,
      startFromPrompt,
    })
    let promptLookupCount = 0
    await openBtwPicker({
      api: harness.api,
      controller,
      activePromptRef: () => {
        promptLookupCount += 1
        return promptLookupCount === 1
          ? undefined
          : harness.promptRef
      },
    })
    const newSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title === "New BTW",
    )
    harness.api.route.navigate("session", {
      sessionID: "ses_other",
    })

    // when
    if (newSide) {
      await harness.dialogSelections[0]?.onSelect?.(newSide)
    }

    // then
    expect(startFromPrompt).not.toHaveBeenCalled()
    expect(harness.toasts).toContain(
      "BTW is unavailable before the session starts.",
    )
  })

  it("#given the parent prompt remounts while its picker stays open #when New BTW is selected #then creation uses the active replacement prompt", async () => {
    // given
    const harness = createPickerHarness()
    const startFromPrompt = mock(async () => true)
    const controller = unsafeTestValue({
      adopt: () => undefined,
      startFromPrompt,
    })
    let activePromptRef = harness.promptRef
    await openBtwPicker({
      api: harness.api,
      controller,
      activePromptRef: () => activePromptRef,
    })
    const replacementPromptRef = unsafeTestValue({
      focused: true,
      current: {
        input: "replacement parent draft",
        parts: [],
      },
      set: () => undefined,
      reset: () => undefined,
      blur: () => undefined,
      focus: () => undefined,
      submit: () => undefined,
    })
    activePromptRef = replacementPromptRef
    const newSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title === "New BTW",
    )

    // when
    if (newSide) {
      await harness.dialogSelections[0]?.onSelect?.(newSide)
    }

    // then
    const promptRef = startFromPrompt.mock.calls[0]?.[0]
    expect(promptRef?.input).toBe("replacement parent draft")
  })

  it("#given retained BTW metadata #when the bare command opens #then the catalog lists the parent and every retained side", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")

    // when
    await openCommand?.run?.()

    // then
    expect(harness.listSessions).toHaveBeenCalled()
    expect(harness.dialogSelections[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("Main"),
        }),
        expect.objectContaining({
          title: expect.stringContaining("first retained question"),
        }),
        expect.objectContaining({
          title: expect.stringContaining("second retained question"),
        }),
      ]),
    )
  })

  it("#given two retained sides #when picker options render #then stable numbers and summaries distinguish every destination", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")

    // when
    await openCommand?.run?.()

    // then
    expect(
      harness.dialogSelections[0]?.options.map((option) => option.title),
    ).toEqual([
      expect.stringContaining("Main"),
      expect.stringContaining("BTW #1"),
      expect.stringContaining("BTW #2"),
      expect.stringContaining("New BTW"),
    ])
  })

  it("#given a bare BTW draft #when open runs #then it opens the picker without creating a session", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")

    // when
    await openCommand?.run?.()

    // then
    expect(harness.dialogSelections).toHaveLength(1)
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.promptInput()).toBe("")
  })

  it("#given the picker catalog is loading #when the user replaces bare BTW #then the newer draft survives", async () => {
    // given
    const harness = createPickerHarness()
    const catalog = createDeferred<{
      data: typeof harness.sessions
    }>()
    const listStarted = createDeferred<void>()
    harness.api.client.session.list = mock(() => {
      listStarted.resolve(undefined)
      return catalog.promise
    })
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    const opening = openCommand?.run?.()
    await listStarted.promise
    expect(harness.api.client.session.list).toHaveBeenCalled()

    // when
    harness.promptRef.set({
      input: "new draft typed while loading",
    })
    catalog.resolve({
      data: harness.sessions,
    })
    await opening

    // then
    expect(harness.promptInput()).toBe(
      "new draft typed while loading",
    )
  })

  it("#given retained BTW options #when a side is selected #then the dialog clears and that session opens", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    await openCommand?.run?.()
    const secondSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title.includes("BTW #2"),
    )

    // when
    if (secondSide) {
      await harness.dialogSelections[0]?.onSelect?.(secondSide)
    }

    // then
    expect(harness.currentSessionID()).toBe("ses_side_2")
  })

  it("#given the BTW picker #when New BTW is selected #then a distinct side is created only after selection", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    await openCommand?.run?.()
    const newSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title === "New BTW",
    )
    expect(harness.createSession).not.toHaveBeenCalled()

    // when
    if (newSide) {
      await harness.dialogSelections[0]?.onSelect?.(newSide)
    }

    // then
    expect(harness.createSession).toHaveBeenCalledTimes(1)
    expect(harness.currentSessionID()).toBe("ses_new_side")
    expect(harness.promptInput()).toBe("")
  })

  it("#given a picker opened for Main #when the route changes before New BTW selection #then stale creation stays unavailable", async () => {
    // given
    const harness = createPickerHarness()
    harness.sessions.push({
      id: "ses_other",
      title: "Other session",
      time: {
        created: 4,
        updated: 4,
      },
    })
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    await openCommand?.run?.()
    const newSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title === "New BTW",
    )
    harness.api.route.navigate("session", {
      sessionID: "ses_other",
    })

    // when
    if (newSide) {
      await harness.dialogSelections[0]?.onSelect?.(newSide)
    }

    // then
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.toasts).toContain(
      "BTW is unavailable before the session starts.",
    )
  })

  it("#given New BTW cannot establish a stable boundary #when selected #then the picker stays open for another choice", async () => {
    // given
    const harness = createPickerHarness("/btw", [])
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    await openCommand?.run?.()
    const newSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title === "New BTW",
    )

    // when
    if (newSide) {
      await harness.dialogSelections[0]?.onSelect?.(newSide)
    }

    // then
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.dialogClears()).toBe(0)
    expect(harness.toasts).toContain(
      "BTW is unavailable before the session starts.",
    )
  })

  it("#given a deleted picker row #when it is selected #then a precise warning appears and the picker refreshes", async () => {
    // given
    const harness = createPickerHarness()
    await registerBtwSideTui(harness.api, harness.solid)
    harness.slots[0]?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const openCommand = harness.layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    await openCommand?.run?.()
    const deletedSide = harness.dialogSelections[0]?.options.find(
      (option) => option.title.includes("BTW #2"),
    )
    const deletedIndex = harness.sessions.findIndex(
      (session) => session.id === "ses_side_2",
    )
    harness.sessions.splice(deletedIndex, 1)

    // when
    if (deletedSide) {
      await harness.dialogSelections[0]?.onSelect?.(deletedSide)
    }

    // then
    expect(harness.currentSessionID()).toBe("ses_parent")
    expect(harness.toasts).toContain(
      "BTW session ses_side_2 no longer exists. Refreshing the list.",
    )
    expect(harness.dialogSelections).toHaveLength(2)
    expect(
      harness.dialogSelections[1]?.options.some(
        (option) => option.title.includes("second retained question"),
      ),
    ).toBe(false)
  })

  it("#given a real-shaped TUI API #when inline BTW runs #then a side session opens and both status surfaces render", async () => {
    // given
    let routeName = "session"
    let routeSessionID = "ses_parent"
    let promptInput = "/btw explain the parent"
    const layers: TestLayer[] = []
    const slashCommands: TestSlashCommand[] = []
    const slots: TestSlotRegistration[] = []
    const disposers: Array<() => void | Promise<void>> = []
    const toasts: string[] = []
    const deleteSession = mock(async () => ({ data: true }))
    const createSession = mock(async () => ({
      data: {
        id: "ses_side",
        title: "BTW · Parent",
      },
    }))
    const promptRef = {
      focused: true,
      get current() {
        return {
          input: promptInput,
          parts: [],
        }
      },
      set(next: { input: string }) {
        promptInput = next.input
      },
      reset: () => undefined,
      blur: () => undefined,
      focus: () => undefined,
      submit: () => undefined,
    }
    const promptRefCallbacks: Array<
      (ref: typeof promptRef | undefined) => void
    > = []
    const api = unsafeTestValue({
      state: {
        path: {
          directory: "/tmp/project",
        },
        session: {
          get: (sessionID: string) =>
            sessionID === "ses_parent"
              ? {
                  id: "ses_parent",
                  title: "Parent",
                  agent: "sisyphus",
                  model: {
                    providerID: "openai",
                    id: "gpt-5.4",
                  },
                }
              : undefined,
          messages: () => [
            {
              id: "msg_parent",
              role: "user",
              time: {
                created: 1,
              },
            },
          ],
          status: () => ({
            type: "idle",
          }),
          permission: () => [],
          question: () => [],
        },
      },
      client: {
        session: {
          get: async () => ({
            data: {
              id: "ses_parent",
              title: "Parent",
            },
          }),
          create: createSession,
          abort: async () => ({
            data: true,
          }),
          delete: deleteSession,
        },
      },
      route: {
        get current() {
          if (routeName !== "session") {
            return {
              name: routeName,
            }
          }
          return {
            name: "session",
            params: {
              sessionID: routeSessionID,
            },
          }
        },
        navigate: (_name: string, params: { sessionID: string }) => {
          routeSessionID = params.sessionID
        },
      },
      command: {
        register: (factory: () => TestSlashCommand[]) => {
          slashCommands.push(...factory())
          return () => undefined
        },
      },
      keymap: {
        registerLayer: (layer: TestLayer) => {
          layers.push(layer)
          return () => undefined
        },
      },
      mode: {
        current: () => "base",
      },
      slots: {
        register: (registration: TestSlotRegistration) => {
          slots.push(registration)
          return "omo-btw-slots"
        },
      },
      event: {
        on: () => () => undefined,
      },
      ui: {
        Prompt: (props: {
          ref?: (ref: typeof promptRef | undefined) => void
        }) => {
          if (props.ref) promptRefCallbacks.push(props.ref)
          props.ref?.(promptRef)
          return {
            tag: "prompt",
          }
        },
        Slot: () => undefined,
        toast: ({ message }: { message: string }) => {
          toasts.push(message)
        },
      },
      theme: {
        current: {
          textMuted: "#888888",
        },
      },
      renderer: {
        requestRender: () => undefined,
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (dispose: () => void | Promise<void>) => {
          disposers.push(dispose)
          return () => undefined
        },
      },
    })
    const solid = unsafeTestValue({
      createElement: (tag: string): TestNode => ({
        tag,
        props: {},
        children: [],
      }),
      insert: (node: TestNode, child: unknown) => {
        node.children.push(child)
      },
      setProp: (node: TestNode, name: string, value: unknown) => {
        node.props[name] = value
      },
    })

    // when
    await registerBtwSideTui(api, solid)
    const slotRegistration = slots[0]
    slotRegistration?.slots.session_prompt?.({}, {
      session_id: "ses_parent",
      visible: true,
      disabled: false,
    })
    const inlineLayer = layers.find((layer) =>
      layer.bindings?.some((binding) => binding.key === "enter,return"),
    )
    const openCommand = layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.open")
    const inlineEnabledBefore = inlineLayer?.enabled?.()
    await openCommand?.run?.()

    // then
    expect(openCommand).toMatchObject({
      namespace: "palette",
      enabled: true,
    })
    expect(slashCommands).toContainEqual(
      expect.objectContaining({
        title: "BTW side conversation",
        value: "omo.btw.slash",
        slash: {
          name: "btw",
          aliases: ["side"],
        },
      }),
    )
    expect(slashCommands[0]?.onSelect).toBeInstanceOf(Function)
    expect(layers.flatMap((layer) => layer.bindings ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ctrl+_",
          cmd: "omo.btw.toggle",
        }),
        expect.objectContaining({
          key: "ctrl+c",
          cmd: "omo.btw.close",
          preventDefault: true,
          fallthrough: false,
        }),
      ]),
    )
    expect(layers.flatMap((layer) => layer.bindings ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ctrl+/",
          cmd: "omo.btw.toggle",
        }),
        expect.objectContaining({
          key: "ctrl+c",
          cmd: "omo.btw.close",
        }),
      ]),
    )
    expect(inlineEnabledBefore).toBe(true)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        [BTW_SIDE_METADATA_KEY]: {
          version: 1,
          parent_session_id: "ses_parent",
          boundary_message_id: "msg_parent",
        },
      },
    })
    expect(routeSessionID).toBe("ses_side")
    expect(promptInput).toBe("")
    expect(toasts).toEqual([])

    const parentStatus = slotRegistration?.slots.session_prompt_right?.({}, {
      session_id: "ses_parent",
    }) as TestNode
    const sideStatus = slotRegistration?.slots.session_prompt_right?.({}, {
      session_id: "ses_side",
    }) as TestNode
    expect(parentStatus.children).toContain(
      "BTW retained · ctrl+/ picker",
    )
    expect(sideStatus.children).toContain(
      "BTW side · main ready · esc esc return · ctrl+/ picker · ctrl+c delete",
    )
    expect(disposers).toHaveLength(1)
    expect(deleteSession).not.toHaveBeenCalled()

    // when
    routeName = "home"
    promptRefCallbacks.at(-1)?.(undefined)
    for (const dispose of disposers) {
      await dispose()
    }

    // then
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
