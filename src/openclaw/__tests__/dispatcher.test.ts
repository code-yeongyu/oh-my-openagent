import { describe, expect, test, mock, spyOn } from "bun:test"
import {
  interpolateInstruction,
  shellEscapeArg,
  wakeGateway,
  wakeCommandGateway,
} from "../dispatcher"

describe("OpenClaw Dispatcher", () => {
  test("interpolateInstruction replaces variables", () => {
    const template = "Hello {{name}}, welcome to {{place}}!"
    const variables = { name: "World", place: "Bun" }
    expect(interpolateInstruction(template, variables)).toBe(
      "Hello World, welcome to Bun!",
    )
  })

  test("interpolateInstruction handles missing variables", () => {
    const template = "Hello {{name}}!"
    const variables = {}
    expect(interpolateInstruction(template, variables)).toBe("Hello !")
  })

  test("shellEscapeArg escapes single quotes", () => {
    expect(shellEscapeArg("foo'bar")).toBe("'foo'\\''bar'")
    expect(shellEscapeArg("simple")).toBe("'simple'")
  })

  test("wakeGateway sends POST request", async () => {
    const fetchSpy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const result = await wakeGateway(
      "test",
      { url: "https://example.com", method: "POST", timeout: 1000, type: "http" },
      { foo: "bar" },
    )

    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe("https://example.com")
    expect(call[1]?.method).toBe("POST")
    expect(call[1]?.body).toBe('{"foo":"bar"}')

    fetchSpy.mockRestore()
  })

  test("wakeGateway fails on invalid URL", async () => {
    const result = await wakeGateway("test", { url: "http://example.com", method: "POST", timeout: 1000, type: "http" }, {})
    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid URL")
  })
})
