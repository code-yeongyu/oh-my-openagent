import { describe, expect, test } from "bun:test"

import { withoutCapabilities } from "./model-chain-engines"

async function runThrough(hidden: readonly string[], chunks: readonly Buffer[]): Promise<string> {
  const transform = withoutCapabilities(hidden)
  let out = ""
  const done = new Promise<void>((resolve) => {
    transform.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8")
    })
    transform.on("end", () => resolve())
  })
  for (const chunk of chunks) transform.write(chunk)
  transform.end()
  await done
  return out
}

describe("withoutCapabilities", () => {
  test("#given a protocol line with a multibyte character split across chunks #when it is rewritten #then the character survives intact and the hidden capability is removed", async () => {
    // given: "caf\u00e9" is 5 bytes in UTF-8; split the line inside the \u00e9 (0xC3 0xA9)
    const line = JSON.stringify({
      command: "get_protocol_info",
      data: { capabilities: ["retry_fallback_profile", "other"], note: "caf\u00e9" },
    })
    const bytes = Buffer.from(`${line}\n`, "utf8")
    const splitAt = bytes.indexOf(0xc3)
    expect(splitAt).toBeGreaterThan(0)

    // when
    const out = await runThrough(
      ["retry_fallback_profile"],
      [bytes.subarray(0, splitAt + 1), bytes.subarray(splitAt + 1)],
    )

    // then: the line parsed (so the hidden capability was filtered) and no replacement character appears
    const parsed = JSON.parse(out.trim()) as { data: { capabilities: string[]; note: string } }
    expect(parsed.data.capabilities).toEqual(["other"])
    expect(parsed.data.note).toBe("caf\u00e9")
    expect(out).not.toContain("\uFFFD")
  })

  test("#given a protocol line split at an ASCII boundary #when it is rewritten #then the hidden capability is removed", async () => {
    // given
    const line = JSON.stringify({
      command: "get_protocol_info",
      data: { capabilities: ["retry_fallback_profile", "other"] },
    })
    const bytes = Buffer.from(`${line}\n`, "utf8")
    const splitAt = Math.floor(bytes.length / 2)

    // when
    const out = await runThrough(["retry_fallback_profile"], [bytes.subarray(0, splitAt), bytes.subarray(splitAt)])

    // then
    const parsed = JSON.parse(out.trim()) as { data: { capabilities: string[] } }
    expect(parsed.data.capabilities).toEqual(["other"])
  })
})
