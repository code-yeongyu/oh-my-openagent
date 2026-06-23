import { describe, test, expect } from "bun:test"
import { createTracer } from "./tracing"

describe("Tracer", () => {
  test("#given empty tracer #when getAll #then returns empty", () => {
    const tracer = createTracer()
    expect(tracer.getAll()).toEqual([])
  })

  test("#given recorded entry #when getAll #then returns it", () => {
    const tracer = createTracer()
    tracer.record({
      timestamp: Date.now(),
      tool: "browser_navigate",
      input: { url: "https://example.com" },
      durationMs: 500,
    })
    expect(tracer.getAll()).toHaveLength(1)
  })

  test("#given error entries #when getErrors #then filters correctly", () => {
    const tracer = createTracer()
    tracer.record({ timestamp: Date.now(), tool: "ok", input: {}, durationMs: 100 })
    tracer.record({ timestamp: Date.now(), tool: "fail", input: {}, error: "timeout", durationMs: 5000 })
    expect(tracer.getErrors()).toHaveLength(1)
    expect(tracer.getErrors()[0]!.tool).toBe("fail")
  })

  test("#given entries #when clear #then getAll returns empty", () => {
    const tracer = createTracer()
    tracer.record({ timestamp: Date.now(), tool: "test", input: {}, durationMs: 50 })
    tracer.clear()
    expect(tracer.getAll()).toHaveLength(0)
  })
})
