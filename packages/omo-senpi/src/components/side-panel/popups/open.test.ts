import { describe, expect, test } from "bun:test"

import type { PanelOverlayUi, PanelPopupFactory, PanelRow } from "../types"

import { openPanelViewer } from "./open"

type Listener = (data: string) => { consume?: boolean; data?: string } | undefined

interface FakeUi extends PanelOverlayUi {
  readonly notices: string[]
  readonly listeners: Listener[]
  readonly unsubscribed: number[]
  rendered(): readonly string[]
  close(): void
}

function fakeUi(options: { overlay?: boolean; rawInput?: boolean } = {}): FakeUi {
  const notices: string[] = []
  const listeners: Listener[] = []
  const unsubscribed: number[] = []
  let component: { render(width: number): string[]; scrollBy(rows: number): void } | undefined
  let finish: (() => void) | undefined
  const ui: FakeUi = {
    notices,
    listeners,
    unsubscribed,
    notify(message) {
      notices.push(message)
    },
    rendered: () => component?.render(60) ?? [],
    close: () => finish?.(),
    ...(options.overlay === false
      ? {}
      : {
          custom(factory: PanelPopupFactory) {
            return new Promise<unknown>((resolve) => {
              const done = (): void => resolve(undefined)
              finish = done
              const built = factory({ requestRender: () => {} }, undefined, undefined, done)
              component = built as { render(width: number): string[]; scrollBy(rows: number): void }
            })
          },
        }),
    ...(options.rawInput === false
      ? {}
      : {
          onTerminalInput(handler: Listener) {
            listeners.push(handler)
            const index = listeners.length - 1
            return () => unsubscribed.push(index)
          },
        }),
  }
  return ui
}

const body = (count: number): readonly PanelRow[] =>
  Array.from({ length: count }, (_value, index) => ({ text: `line ${index + 1}` }))

describe("openPanelViewer", () => {
  test("#given a wheel report while the viewer is open #when it arrives #then the viewer scrolls and claims it", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))
    const before = ui.rendered().join("\n")

    // when
    const result = ui.listeners[0]?.("\u001b[<65;10;5M")

    // then the transcript behind must not scroll too, so the event is claimed
    expect(result).toEqual({ consume: true })
    expect(ui.rendered().join("\n")).not.toBe(before)

    ui.close()
    await opened
  })

  test("#given a keystroke #when it arrives #then it is passed on untouched", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))

    // when / then
    expect(ui.listeners[0]?.("q")).toBeUndefined()

    ui.close()
    await opened
  })

  test("#given the viewer is closed #when it resolves #then the wheel listener is released", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))

    // when
    ui.close()
    await opened

    // then
    expect(ui.unsubscribed).toEqual([0])
  })

  test("#given a host with no raw-input seam #when opened #then the viewer still works", async () => {
    // given
    const ui = fakeUi({ rawInput: false })

    // when
    const opened = openPanelViewer(ui, "title", body(4))
    expect(ui.rendered().length).toBeGreaterThan(0)
    ui.close()
    await opened

    // then
    expect(ui.notices).toEqual([])
  })

  test("#given a host with no overlay seam #when opened #then the rows arrive as one notification", async () => {
    // given
    const ui = fakeUi({ overlay: false })

    // when
    await openPanelViewer(ui, "title", body(2))

    // then
    expect(ui.notices).toEqual(["line 1\nline 2"])
  })
})
