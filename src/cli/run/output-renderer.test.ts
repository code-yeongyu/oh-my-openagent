import { afterEach, describe, expect, it, spyOn, test } from "bun:test"

import { renderAgentHeader } from "./output-renderer"

const originalWrite = process.stdout.write.bind(process.stdout)

function captureStdout(run: () => void): string {
  const chunks: string[] = []
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return true
  }) as typeof process.stdout.write

  try {
    run()
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write
  }

  return chunks.join("")
}

afterEach(() => {
  process.stdout.write = originalWrite as typeof process.stdout.write
  delete process.env.NO_COLOR
})

describe("renderAgentHeader", () => {
  it("preserves CJK agent display names in stdout output", () => {
    const output = captureStdout(() => {
      renderAgentHeader("Sisyphus - 主脑", "zhipu/glm-5.1", "xhigh", {})
    })

    expect(output).toContain("Sisyphus - 主脑")
    expect(output).toContain("zhipu/glm-5.1")
  })

  it("normalizes decomposed Unicode before rendering", () => {
    const output = captureStdout(() => {
      renderAgentHeader("헤파", null, null, {})
    })

    expect(output).toContain("헤파")
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
