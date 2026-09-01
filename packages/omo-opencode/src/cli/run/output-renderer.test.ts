import { afterEach, describe, expect, it } from "bun:test"

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
      renderAgentHeader("헤파", null, null, {})
    })

    expect(output).toContain("헤파")
  })
})
