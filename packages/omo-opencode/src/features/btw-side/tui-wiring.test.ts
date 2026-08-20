import { describe, expect, it, mock } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { BTW_SIDE_METADATA_KEY } from "./metadata"
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

describe("registerBtwSideTui", () => {
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
    let resolveDeleted!: () => void
    const deleted = new Promise<void>((resolve) => {
      resolveDeleted = resolve
    })
    const deleteSession = mock(async () => {
      resolveDeleted()
      return { data: true }
    })
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
    expect(layers.every((layer) => layer.mode === "base")).toBe(true)
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
    expect(parentStatus.children).toContain("BTW open · ctrl+/ switch")
    expect(sideStatus.children).toContain(
      "BTW from main · main ready · ctrl+/ switch · ctrl+c close",
    )
    expect(disposers).toHaveLength(1)
    expect(deleteSession).not.toHaveBeenCalled()

    // when
    routeName = "home"
    promptRefCallbacks.at(-1)?.(undefined)
    await deleted

    // then
    expect(deleteSession).toHaveBeenCalledTimes(1)
  })
})
