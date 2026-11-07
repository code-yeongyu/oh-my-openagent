import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "./types"
import { fetchSyncResult } from "./sync-result-fetcher"

const TRUNCATION_NOTICE =
  "\n\n[... truncated. Use background_output with full_session=true to retrieve the complete output.]"

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function createMockClient(configResult: unknown, text: string): OpencodeClient {
  return {
    app: {
      agents: async () => [],
    },
    config: {
      get: async () => configResult,
    },
    session: {
      abort: async () => undefined,
      create: async () => ({ data: { id: "ses_created" } }),
      get: async () => ({ data: { directory: "/tmp" } }),
      messages: async () => ({
        data: [
          {
            info: { id: "msg_001", role: "assistant", time: { created: 1000 } },
            parts: [{ type: "text", text }],
          },
        ],
      }),
      status: async () => ({}),
    },
  }
}

describe("sync result truncation", () => {
  test("uses the configured OpenCode tool output byte limit", async () => {
    //#given - a sync result larger than the host's configured output limit
    const maxBytes = 1024
    const fullText = "x".repeat(maxBytes + 100)
    const client = createMockClient({ data: { tool_output: { max_bytes: maxBytes } } }, fullText)

    //#when
    const result = await fetchSyncResult(client, "ses_test")

    //#then - the returned payload is bounded while the recovery hint remains
    const expectedPrefix = "x".repeat(maxBytes - byteLength(TRUNCATION_NOTICE))
    expect(result).toEqual({ ok: true, textContent: `${expectedPrefix}${TRUNCATION_NOTICE}` })
  })

  test("uses 8192 bytes when OpenCode does not configure tool output", async () => {
    //#given - a large sync result and no host truncation setting
    const maxBytes = 8192
    const fullText = "x".repeat(maxBytes + 1)
    const client = createMockClient({ data: {} }, fullText)

    //#when
    const result = await fetchSyncResult(client, "ses_test")

    //#then - the default limit bounds the result and retains the recovery hint
    const expectedPrefix = "x".repeat(maxBytes - byteLength(TRUNCATION_NOTICE))
    expect(result).toEqual({ ok: true, textContent: `${expectedPrefix}${TRUNCATION_NOTICE}` })
  })

  test("does not split a multibyte character when truncating by bytes", async () => {
    //#given - a multibyte sync result with only a partial character before the limit
    const maxBytes = byteLength(TRUNCATION_NOTICE) + 3
    const client = createMockClient(
      { data: { tool_output: { max_bytes: maxBytes } } },
      "😀".repeat(400),
    )

    //#when
    const result = await fetchSyncResult(client, "ses_test")

    //#then - the incomplete character is omitted and the final payload stays bounded
    expect(result).toEqual({ ok: true, textContent: TRUNCATION_NOTICE })
    if (result.ok) {
      expect(byteLength(result.textContent)).toBeLessThanOrEqual(maxBytes)
    }
  })
})
