import { describe, it, expect, mock } from "bun:test"
import { EventEmitter } from "node:events"
import { suppressRunInput } from "./stdin-suppression"

type FakeStdin = EventEmitter & {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode: ReturnType<typeof mock<(mode: boolean) => void>>
  isPaused: ReturnType<typeof mock<() => boolean>>
  resume: ReturnType<typeof mock<() => void>>
  pause: ReturnType<typeof mock<() => void>>
}

function createFakeStdin(options: {
  isTTY?: boolean
  isRaw?: boolean
  paused?: boolean
} = {}): FakeStdin {
  const emitter = new EventEmitter() as FakeStdin
  emitter.isTTY = options.isTTY ?? true
  emitter.isRaw = options.isRaw ?? false
  emitter.setRawMode = mock((mode: boolean) => {
    emitter.isRaw = mode
  })
  emitter.isPaused = mock(() => options.paused ?? false)
  emitter.resume = mock(() => {})
  emitter.pause = mock(() => {})
  return emitter
}

describe("suppressRunInput", () => {
  it("ignores non-tty stdin", () => {
    // given
    const stdin = createFakeStdin({ isTTY: false })
    const onInterrupt = mock(() => {})

    // when
    const restore = suppressRunInput(stdin, onInterrupt)
    restore()

    // then
    expect(stdin.setRawMode).not.toHaveBeenCalled()
    expect(stdin.resume).not.toHaveBeenCalled()
    expect(onInterrupt).not.toHaveBeenCalled()
  })

  it("enables raw mode and restores it", () => {
    // given
    const stdin = createFakeStdin({ isRaw: false, paused: true })

    // when
    const restore = suppressRunInput(stdin)
    restore()

    // then
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(stdin.resume).toHaveBeenCalledTimes(1)
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(2, false)
    expect(stdin.pause).toHaveBeenCalledTimes(1)
  })

  it("calls interrupt handler on ctrl-c", () => {
    // given
    const stdin = createFakeStdin()
    const onInterrupt = mock(() => {})
    const restore = suppressRunInput(stdin, onInterrupt)

    // when
    stdin.emit("data", "\u0003")
    restore()

    // then
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  it("does not call interrupt handler on arrow-key escape", () => {
    // given
    const stdin = createFakeStdin()
    const onInterrupt = mock(() => {})
    const restore = suppressRunInput(stdin, onInterrupt)

    // when
    stdin.emit("data", "\u001b[A")
    restore()

    // then
    expect(onInterrupt).not.toHaveBeenCalled()
  })
})
