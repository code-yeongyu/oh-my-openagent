/// <reference types="bun-types" />

import { describe, expect, it, afterEach } from "bun:test"

import { getContextWindowUsage, truncateToTokenLimit } from "./dynamic-truncator"
const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

function resetContextLimitEnv(): void {
  if (originalAnthropicContextEnv === undefined) {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
  } else {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = originalAnthropicContextEnv
  }

  if (originalVertexContextEnv === undefined) {
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  } else {
    process.env[VERTEX_CONTEXT_ENV_KEY] = originalVertexContextEnv
  }
}

function createContextUsageMockContext(inputTokens: number) {
  return {
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                tokens: {
                  input: inputTokens,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
            },
          ],
        }),
      },
    },
  }
}

describe("getContextWindowUsage", () => {
	afterEach(() => {
		resetContextLimitEnv()
	})

	it("uses 1M limit when model cache flag is enabled", async () => {
		//#given
		delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
		delete process.env[VERTEX_CONTEXT_ENV_KEY]
		const ctx = createContextUsageMockContext(300000)

		//#when
		const usage = await getContextWindowUsage(ctx as never, "ses_1m_flag", {
			anthropicContext1MEnabled: true,
		})

		//#then
		expect(usage?.usagePercentage).toBe(0.3)
		expect(usage?.remainingTokens).toBe(700000)
	})

	it("uses 200K limit when model cache flag is disabled and env vars are unset", async () => {
		//#given
		delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
		delete process.env[VERTEX_CONTEXT_ENV_KEY]
		const ctx = createContextUsageMockContext(150000)

		//#when
		const usage = await getContextWindowUsage(ctx as never, "ses_default", {
			anthropicContext1MEnabled: false,
		})

		//#then
		expect(usage?.usagePercentage).toBe(0.75)
		expect(usage?.remainingTokens).toBe(50000)
	})

	it("keeps env var fallback when model cache flag is disabled", async () => {
		//#given
		process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
		const ctx = createContextUsageMockContext(300000)

		//#when
		const usage = await getContextWindowUsage(ctx as never, "ses_env_fallback", {
			anthropicContext1MEnabled: false,
		})

		//#then
		expect(usage?.usagePercentage).toBe(0.3)
		expect(usage?.remainingTokens).toBe(700000)
	})
})

describe("truncateToTokenLimit with compression", () => {
	it("returns original output when compression is disabled", () => {
		//#given
		const output = JSON.stringify([{ id: 1, name: "test" }])
		const config = { enabled: false, threshold: 100 }

		//#when
		const result = truncateToTokenLimit(output, 10000, 3, config)

		//#then
		expect(result.result).toBe(output)
		expect(result.truncated).toBe(false)
	})

	it("applies compression before truncation when enabled", () => {
		//#given
		const items = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item${i}` }))
		const output = JSON.stringify(items)
		const config = { enabled: true, threshold: 100 }

		//#when
		const result = truncateToTokenLimit(output, 10000, 3, config)

		//#then
		expect(result.truncated).toBe(false)
		// Compression should produce smaller output for uniform arrays
		expect(result.result.length).toBeLessThan(output.length)
	})

	it("bypasses compression for non-JSON output", () => {
		//#given
		const output = "This is plain text output, not JSON"
		const config = { enabled: true, threshold: 100 }

		//#when
		const result = truncateToTokenLimit(output, 10000, 3, config)

		//#then
		expect(result.result).toBe(output)
		expect(result.truncated).toBe(false)
	})

	it("uses default disabled config when not provided", () => {
		//#given
		const items = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item${i}` }))
		const output = JSON.stringify(items)

		//#when
		const result = truncateToTokenLimit(output, 10000, 3)

		//#then
		expect(result.result).toBe(output)
		expect(result.truncated).toBe(false)
	})

	it("truncates compressed output when it exceeds token limit", () => {
		//#given
		const items = Array.from({ length: 100 }, (_, i) => ({
			id: i,
			name: `item${i}`,
			description: "x".repeat(100),
		}))
		const output = JSON.stringify(items)
		const config = { enabled: true, threshold: 100 }
		const smallTokenLimit = 500

		//#when
		const result = truncateToTokenLimit(output, smallTokenLimit, 1, config)

		//#then
		expect(result.truncated).toBe(true)
		expect(result.result).toContain("truncated")
	})

	it("compresses error-like JSON data but preserves content", () => {
		//#given
		const output = JSON.stringify({ error: "Something went wrong" })
		const config = { enabled: true, threshold: 100 }

		//#when
		const result = truncateToTokenLimit(output, 10000, 3, config)

		//#then
		// Error-like data should not be compressed
		expect(result.result).toContain("Something went wrong")
	})
})
