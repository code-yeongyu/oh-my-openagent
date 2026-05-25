import { describe, it, expect } from "bun:test"
import {
  TuiRenderer,
  color256,
  bgColor256,
  bold,
  dim,
  colorForStatus,
} from "./renderer"

describe("TuiRenderer", () => {
  describe("#given a fresh renderer", () => {
    // given
    const renderer = new TuiRenderer()

    it("#then isRunning returns false initially", () => {
      expect(renderer.isRunning()).toBe(false)
    })

    it("#then getSize returns numbers", () => {
      const size = renderer.getSize()
      expect(typeof size.rows).toBe("number")
      expect(typeof size.cols).toBe("number")
      expect(size.rows).toBeGreaterThan(0)
      expect(size.cols).toBeGreaterThan(0)
    })

    it("#then stop is idempotent (does not throw)", () => {
      expect(() => renderer.stop()).not.toThrow()
    })
  })

  describe("#given a started renderer", () => {
    // given
    const renderer = new TuiRenderer()

    it("#then start sets isRunning to true", () => {
      renderer.start()
      expect(renderer.isRunning()).toBe(true)
      // when
      renderer.stop()
      // then
      expect(renderer.isRunning()).toBe(false)
    })

    it("#then stop sets isRunning to false", () => {
      renderer.start()
      expect(renderer.isRunning()).toBe(true)
      renderer.stop()
      expect(renderer.isRunning()).toBe(false)
    })
  })
})

describe("ANSI helpers", () => {
  describe("color256", () => {
    it("#then wraps text in expected ANSI codes", () => {
      expect(color256(35, "hello")).toBe("\x1b[38;5;35mhello\x1b[0m")
    })
  })

  describe("bgColor256", () => {
    it("#then wraps text in background ANSI codes", () => {
      expect(bgColor256(220, "hello")).toBe("\x1b[48;5;220mhello\x1b[0m")
    })
  })

  describe("bold", () => {
    it("#then wraps text in bold ANSI codes", () => {
      expect(bold("hello")).toBe("\x1b[1mhello\x1b[22m")
    })
  })

  describe("dim", () => {
    it("#then wraps text in dim ANSI codes", () => {
      expect(dim("hello")).toBe("\x1b[2mhello\x1b[22m")
    })
  })
})

describe("colorForStatus", () => {
  it("#then returns correct color codes for known statuses", () => {
    expect(colorForStatus("running")).toBe(35)
    expect(colorForStatus("idle")).toBe(220)
    expect(colorForStatus("error")).toBe(124)
    expect(colorForStatus("completed")).toBe(39)
    expect(colorForStatus("blocked")).toBe(208)
  })

  it("#then returns default gray for unknown status", () => {
    expect(colorForStatus("unknown")).toBe(245)
    expect(colorForStatus("")).toBe(245)
  })
})
