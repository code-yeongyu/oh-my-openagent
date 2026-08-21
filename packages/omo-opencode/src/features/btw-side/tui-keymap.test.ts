import { describe, expect, it, mock } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import type {
  KeyInputContext,
  RawInputContext,
} from "@opentui/keymap"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { registerBtwSideKeymap } from "./tui-keymap"

type TestCommand = {
  name: string
  run?: () => void | Promise<void>
}

type TestLayer = {
  commands?: TestCommand[]
  bindings?: Array<{
    key: string
    cmd: string
  }>
}

describe("registerBtwSideKeymap", () => {
  it("#given retained BTW sessions #when switch bindings register #then every Ctrl slash encoding opens the picker", async () => {
    // given
    const layers: TestLayer[] = []
    const openPicker = mock(async () => undefined)
    const toggle = mock(() => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: (layer: TestLayer) => {
          layers.push(layer)
          return () => undefined
        },
      },
      mode: {
        current: () => "base",
      },
    })
    const controller = unsafeTestValue({
      state: () => ({
        phase: "open",
        parentSessionID: "ses_parent",
        sideSessionID: "ses_side",
        owned: true,
      }),
      toggle,
      canCloseCurrentSide: () => true,
      close: async () => undefined,
    })

    // when
    registerBtwSideKeymap(unsafeTestValue({
      api,
      controller,
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker,
    }))
    const switchCommand = layers
      .flatMap((layer) => layer.commands ?? [])
      .find((command) => command.name === "omo.btw.toggle")
    await switchCommand?.run?.()

    // then
    expect(
      layers.flatMap((layer) => layer.bindings ?? []),
    ).toEqual(
      expect.arrayContaining([
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
      ]),
    )
    expect(openPicker).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
  })

  it("#given xterm encodes Ctrl slash as control underscore #when intercepted #then the picker command dispatches before host handling", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const openPicker = mock(async () => undefined)
    const consume = mock(() => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: () => () => undefined,
        intercept: (
          _name: string,
          interceptor: (context: KeyInputContext<KeyEvent>) => void,
        ) => {
          keyInterceptor = interceptor
          return () => undefined
        },
        clearPendingSequence: () => undefined,
      },
      mode: {
        current: () => "base",
      },
      ui: {
        dialog: {
          open: false,
        },
      },
    })
    registerBtwSideKeymap(unsafeTestValue({
      api,
      controller: {
        state: () => ({ phase: "closed" }),
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker,
      isCurrentSideIdle: () => false,
      returnToParent: () => undefined,
    }))

    // when
    keyInterceptor?.(unsafeTestValue({
      event: {
        name: "_",
        ctrl: true,
        eventType: "press",
      },
      setData: () => undefined,
      getData: () => undefined,
      consume,
    }))

    // then
    expect(consume).toHaveBeenCalledWith({
      preventDefault: true,
      stopPropagation: true,
    })
    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it("#given xterm emits the Ctrl slash control byte #when raw input arrives #then parsing is stopped and the picker opens", () => {
    // given
    let rawInterceptor:
      | ((context: RawInputContext) => void)
      | undefined
    const openPicker = mock(async () => undefined)
    const stop = mock(() => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: () => () => undefined,
        intercept: (
          name: string,
          interceptor: (context: RawInputContext) => void,
        ) => {
          if (name === "raw") rawInterceptor = interceptor
          return () => undefined
        },
        clearPendingSequence: () => undefined,
      },
      mode: {
        current: () => "base",
      },
      ui: {
        dialog: {
          open: false,
        },
        toast: () => undefined,
      },
    })
    registerBtwSideKeymap(unsafeTestValue({
      api,
      controller: {
        state: () => ({ phase: "closed" }),
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker,
      isCurrentSideIdle: () => false,
      returnToParent: () => undefined,
    }))

    // when
    rawInterceptor?.({
      sequence: "\u001f",
      stop,
    })

    // then
    expect(stop).toHaveBeenCalledTimes(1)
    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it("#given the parser drops xterm Ctrl slash #when raw stdin receives it #then BTW opens the picker once", async () => {
    // given
    let stdinData: ((data: Buffer) => void) | undefined
    const openPicker = mock(async () => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: () => () => undefined,
        intercept: () => () => undefined,
        clearPendingSequence: () => undefined,
      },
      mode: {
        current: () => "base",
      },
      ui: {
        dialog: {
          open: false,
        },
        toast: () => undefined,
      },
      renderer: {
        stdin: {
          prependListener: (
            _name: string,
            handler: (data: Buffer) => void,
          ) => {
            stdinData = handler
          },
          off: () => undefined,
        },
      },
    })
    registerBtwSideKeymap(unsafeTestValue({
      api,
      controller: {
        state: () => ({ phase: "closed" }),
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker,
      isCurrentSideIdle: () => false,
      returnToParent: () => undefined,
    }))

    // when
    stdinData?.(Buffer.from("paste\u001fcontent"))
    stdinData?.(Buffer.from([0x1f]))
    stdinData?.(Buffer.from([0x1f]))
    await Promise.resolve()

    // then
    expect(openPicker).toHaveBeenCalledTimes(1)
  })
})
