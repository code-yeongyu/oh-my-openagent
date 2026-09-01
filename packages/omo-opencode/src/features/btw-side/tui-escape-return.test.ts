import { describe, expect, it, mock } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import type { KeyInputContext } from "@opentui/keymap"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createBtwEscapeReturn } from "./tui-escape-return"
import { registerBtwSideKeymap } from "./tui-keymap"

describe("registerBtwSideKeymap escape return", () => {
  it("#given the first Escape has expired #when Escape is pressed again #then it starts a fresh pair", () => {
    // given
    let now = 0
    const returnToParent = mock(() => undefined)
    const escapeReturn = createBtwEscapeReturn({
      isCurrentSideIdle: () => true,
      isDialogOpen: () => false,
      clearPending: () => undefined,
      returnToParent,
      now: () => now,
    })
    const sendEscape = () => {
      escapeReturn.handle(unsafeTestValue({
        event: {
          name: "escape",
          eventType: "press",
        },
        consume: () => undefined,
      }))
    }
    sendEscape()

    // when
    now = 1_001
    sendEscape()

    // then
    expect(returnToParent).not.toHaveBeenCalled()

    // when
    now = 1_100
    sendEscape()

    // then
    expect(returnToParent).toHaveBeenCalledTimes(1)
  })

  it("#given an idle visible side #when Escape is pressed twice consecutively #then only the second press returns to the parent", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const returnToParent = mock(() => undefined)
    const firstConsume = mock(() => undefined)
    const secondConsume = mock(() => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: () => () => undefined,
        intercept: (
          name: string,
          interceptor: (context: KeyInputContext<KeyEvent>) => void,
        ) => {
          if (name === "key") keyInterceptor = interceptor
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
    const controller = unsafeTestValue({
      state: () => ({
        phase: "open",
        parentSessionID: "ses_parent",
        sideSessionID: "ses_side",
        owned: true,
      }),
      toggle: () => undefined,
      canCloseCurrentSide: () => true,
      close: async () => undefined,
    })

    registerBtwSideKeymap(unsafeTestValue({
      api,
      controller,
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker: async () => undefined,
      isCurrentSideIdle: () => true,
      returnToParent,
    }))
    const escapeEvent = unsafeTestValue({
      name: "escape",
      eventType: "press",
    })

    // when
    keyInterceptor?.(unsafeTestValue({
      event: escapeEvent,
      setData: () => undefined,
      getData: () => undefined,
      consume: firstConsume,
    }))
    keyInterceptor?.(unsafeTestValue({
      event: escapeEvent,
      setData: () => undefined,
      getData: () => undefined,
      consume: secondConsume,
    }))

    // then
    expect(keyInterceptor).toBeInstanceOf(Function)
    expect(firstConsume).not.toHaveBeenCalled()
    expect(secondConsume).toHaveBeenCalledWith({
      preventDefault: true,
      stopPropagation: true,
    })
    expect(returnToParent).toHaveBeenCalledTimes(1)
  })

  it("#given a busy visible side #when Escape is pressed #then host interruption remains unconsumed", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const consume = mock(() => undefined)
    const returnToParent = mock(() => undefined)
    const api = unsafeTestValue({
      keymap: {
        registerLayer: () => () => undefined,
        intercept: (
          name: string,
          interceptor: (context: KeyInputContext<KeyEvent>) => void,
        ) => {
          if (name === "key") keyInterceptor = interceptor
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
        toggle: () => undefined,
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker: async () => undefined,
      isCurrentSideIdle: () => false,
      returnToParent,
    }))

    // when
    keyInterceptor?.(unsafeTestValue({
      event: {
        name: "escape",
        eventType: "press",
      },
      setData: () => undefined,
      getData: () => undefined,
      consume,
    }))

    // then
    expect(keyInterceptor).toBeInstanceOf(Function)
    expect(consume).not.toHaveBeenCalled()
    expect(returnToParent).not.toHaveBeenCalled()
  })

  it("#given one pending Escape #when a non-Escape key intervenes #then the next Escape starts a fresh sequence", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const returnToParent = mock(() => undefined)
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
      openPicker: async () => undefined,
      isCurrentSideIdle: () => true,
      returnToParent,
    }))
    const press = (name: string) => {
      keyInterceptor?.(unsafeTestValue({
        event: {
          name,
          eventType: "press",
        },
        setData: () => undefined,
        getData: () => undefined,
        consume: () => undefined,
      }))
    }

    // when
    press("escape")
    press("a")
    press("escape")

    // then
    expect(returnToParent).not.toHaveBeenCalled()
  })

  it("#given one pending Escape #when a dialog opens #then dialog Escape resets the sequence", () => {
    // given
    let dialogOpen = false
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const returnToParent = mock(() => undefined)
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
          get open() {
            return dialogOpen
          },
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
      openPicker: async () => undefined,
      isCurrentSideIdle: () => true,
      returnToParent,
    }))
    const pressEscape = () => {
      keyInterceptor?.(unsafeTestValue({
        event: {
          name: "escape",
          eventType: "press",
        },
        setData: () => undefined,
        getData: () => undefined,
        consume: () => undefined,
      }))
    }

    // when
    pressEscape()
    dialogOpen = true
    pressEscape()
    dialogOpen = false
    pressEscape()

    // then
    expect(returnToParent).not.toHaveBeenCalled()
  })

  it("#given one pending Escape #when navigation resets controls #then the next Escape does not return", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const returnToParent = mock(() => undefined)
    const registration = registerBtwSideKeymap(unsafeTestValue({
      api: {
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
      },
      controller: {
        state: () => ({ phase: "closed" }),
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker: async () => undefined,
      isCurrentSideIdle: () => true,
      returnToParent,
    }))
    const pressEscape = () => {
      keyInterceptor?.(unsafeTestValue({
        event: {
          name: "escape",
          eventType: "press",
        },
        setData: () => undefined,
        getData: () => undefined,
        consume: () => undefined,
      }))
    }

    // when
    pressEscape()
    registration.resetEscapeSequence()
    pressEscape()

    // then
    expect(returnToParent).not.toHaveBeenCalled()
  })

  it("#given one pending Escape #when a held Escape repeats #then a later press starts a fresh sequence", () => {
    // given
    let keyInterceptor:
      | ((context: KeyInputContext<KeyEvent>) => void)
      | undefined
    const returnToParent = mock(() => undefined)
    registerBtwSideKeymap(unsafeTestValue({
      api: {
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
      },
      controller: {
        state: () => ({ phase: "closed" }),
        canCloseCurrentSide: () => false,
        close: async () => undefined,
      },
      activePromptRef: () => undefined,
      openBtw: async () => undefined,
      openPicker: async () => undefined,
      isCurrentSideIdle: () => true,
      returnToParent,
    }))
    const sendEscape = (eventType: "press" | "repeat") => {
      keyInterceptor?.(unsafeTestValue({
        event: {
          name: "escape",
          eventType,
        },
        setData: () => undefined,
        getData: () => undefined,
        consume: () => undefined,
      }))
    }

    // when
    sendEscape("press")
    sendEscape("repeat")
    sendEscape("press")

    // then
    expect(returnToParent).not.toHaveBeenCalled()
  })
})
