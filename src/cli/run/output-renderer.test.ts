import { afterEach, describe, expect, spyOn, test } from "bun:test"

describe("renderAgentHeader", () => {
  afterEach(() => {
    delete process.env.NO_COLOR
  })

  test("does not emit raw truecolor escapes when NO_COLOR is set", async () => {
    // given
    process.env.NO_COLOR = "1"
    const writes: string[] = []
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
      return true
    }) as typeof process.stdout.write)
    const { renderAgentHeader } = await import(`./output-renderer?no-color-${Date.now()}`)

    // when
    renderAgentHeader("Sisyphus", null, null, { Sisyphus: "#11aa22" })

    // then
    expect(writeSpy).toHaveBeenCalled()
    expect(writes.join("")).not.toContain("\u001b[38;2;")
  })
})
