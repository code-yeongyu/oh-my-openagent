/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

import { MIRROR_SCHEMA_VERSION, POLL_INTERVAL_MS } from "./features/tui-sidebar/constants"
import { readMirror, writeMirror } from "./features/tui-sidebar/mirror-io"

type SidebarApiForTest = {
  readonly state: {
    readonly path: {
      readonly directory: string
    }
    readonly session: {
      readonly get: () => undefined
      readonly messages: () => []
      readonly status: () => { readonly type: "idle" }
      readonly permission: () => []
      readonly question: () => []
    }
  }
  readonly theme: {
    readonly current: Record<string, unknown>
  }
  readonly slots: {
    readonly register: (registration: TuiSlotPlugin) => string
  }
  readonly client: {
    readonly session: {
      readonly list: () => Promise<{ readonly data: [] }>
      readonly create: () => Promise<{ readonly data: undefined }>
      readonly abort: () => Promise<{ readonly data: true }>
      readonly delete: () => Promise<{ readonly data: true }>
    }
  }
  readonly keymap: {
    readonly registerLayer: () => () => void
  }
  readonly mode: {
    readonly current: () => string
  }
  readonly route: {
    readonly current: {
      readonly name: "home"
    }
    readonly navigate: () => void
  }
  readonly event: {
    readonly on: () => () => void
  }
  readonly ui: {
    readonly Prompt: () => undefined
    readonly Slot: () => undefined
    readonly toast: () => void
  }
  readonly renderer: {
    readonly requestRender: () => void
  }
  readonly lifecycle: {
    readonly signal: AbortSignal
    readonly onDispose: (dispose: () => void) => () => void
  }
}

describe("TUI sidebar polling", () => {
  let tempDir = ""
  const originalSetTimeout = globalThis.setTimeout
  const originalXdgDataHome = process.env.XDG_DATA_HOME

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-tui-test-"))
    process.env.XDG_DATA_HOME = tempDir
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("#given the TUI plugin starts #when it registers the sidebar slot #then an initial render is requested immediately", async () => {
    // given
    const calls: string[] = []
    const disposers: (() => void)[] = []
    let registration: TuiSlotPlugin | undefined
    let scheduledTicks: Array<() => void | Promise<void>> = []

    globalThis.setTimeout = ((callback: () => void | Promise<void>, delay?: number) => {
      if (delay === POLL_INTERVAL_MS) {
        scheduledTicks.push(callback)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }
      return originalSetTimeout(callback, delay)
    }) as typeof setTimeout

    const solidRuntime = await import("solid-js/dist/solid.js")
    mock.module("solid-js", () => solidRuntime)
    const { default: tuiModule } = await import("./tui")
    const solid = await import("@opentui/solid")

    const api = {
      state: {
        path: { directory: tempDir },
        session: {
          get: () => undefined,
          messages: () => [],
          status: () => ({ type: "idle" as const }),
          permission: () => [],
          question: () => [],
        },
      },
      theme: { current: {} },
      slots: {
        register: (nextRegistration: TuiSlotPlugin): string => {
          calls.push("register")
          registration = nextRegistration
          return "omo-sidebar-slot"
        },
      },
      client: {
        session: {
          list: async () => ({ data: [] }),
          create: async () => ({ data: undefined }),
          abort: async () => ({ data: true as const }),
          delete: async () => ({ data: true as const }),
        },
      },
      keymap: {
        registerLayer: (): (() => void) => () => undefined,
      },
      mode: {
        current: () => "base",
      },
      route: {
        current: { name: "home" as const },
        navigate: () => undefined,
      },
      event: {
        on: (): (() => void) => () => undefined,
      },
      ui: {
        Prompt: () => undefined,
        Slot: () => undefined,
        toast: () => undefined,
      },
      renderer: {
        requestRender: (): void => {
          calls.push("render")
        },
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (dispose: () => void): (() => void) => {
          disposers.push(dispose)
          return () => undefined
        },
      },
    } satisfies SidebarApiForTest

    // when
    await tuiModule.tui(api as unknown as TuiPluginApi, undefined, {} as TuiPluginMeta)
    expect(scheduledTicks).toHaveLength(1)
    const activeTick = scheduledTicks.at(-1)
    expect(activeTick?.name).toBe("tick")
    scheduledTicks = []

    // then
    expect(calls).toEqual(["register", "register", "render"])
    expect(registration).toBeDefined()
    if (!registration) {
      throw new Error("sidebar slot was not registered")
    }
    expect(registration.order).toBe(900)
    expect(Object.keys(registration.slots)).toEqual(["sidebar_content"])
    expect(registration.slots.sidebar_content).toBeFunction()

    const renderSidebar = registration.slots.sidebar_content as () => ReturnType<typeof solid.createElement>
    const mountedSidebar = await solid.testRender(renderSidebar, { width: 80, height: 30 })
    writeMirror(tempDir, {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: tempDir,
      updatedAt: Date.now(),
      activeAgents: [{ name: "runtime-agent", status: "busy" }],
      jobBoard: [],
      loop: null,
    })
    expect(readMirror(tempDir)?.activeAgents).toEqual([{ name: "runtime-agent", status: "busy" }])
    if (!activeTick) throw new Error("sidebar poll was not scheduled")
    await activeTick()
    expect(calls).toEqual(["register", "register", "render", "render"])
    await mountedSidebar.renderOnce()
    expect(mountedSidebar.captureCharFrame()).toContain("runtime-agent")

    writeMirror(tempDir, {
      version: MIRROR_SCHEMA_VERSION,
      projectDir: tempDir,
      updatedAt: Date.now(),
      activeAgents: [],
      jobBoard: [],
      loop: null,
    })
    const idleTick = scheduledTicks.at(-1)
    if (!idleTick) throw new Error("next sidebar poll was not scheduled")
    scheduledTicks = []
    await idleTick()
    expect(calls).toEqual(["register", "register", "render", "render", "render"])
    await mountedSidebar.renderOnce()
    expect(mountedSidebar.captureCharFrame()).not.toContain("runtime-agent")

    for (const dispose of disposers) dispose()
    mountedSidebar.renderer.destroy()
  })

  it("#given an unexpected Error during polling #when the poll error handler runs #then the error is logged", async () => {
    // given
    const pollError = new TypeError("view derivation failed")
    const reportedErrors: Error[] = []
    const { handleTuiPollError } = await import("./tui")

    // when
    handleTuiPollError(pollError, (error) => {
      reportedErrors.push(error)
    })

    // then
    expect(reportedErrors).toEqual([pollError])
  })

  it("#given a non-Error throw during polling #when the poll error handler runs #then the value is rethrown", async () => {
    // given
    const thrownValue = "bad poll state"
    const { handleTuiPollError } = await import("./tui")

    expect(() => handleTuiPollError(thrownValue)).toThrow(thrownValue)
  })
})
