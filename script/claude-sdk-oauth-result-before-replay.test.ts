import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const senpiRoot = join(import.meta.dir, "..", "node_modules", "@code-yeongyu", "senpi", "dist", "core", "extensions", "builtin", "claude-sdk-oauth")

// This imports the installed Senpi runtime so the pinned release keeps surfacing a pre-replay SDK
// result as the failure it reports (senpi 2026.9.3-2 ships this natively; omo used to patch it in).
describe("claude-sdk-oauth result-before-replay", () => {
  test("surfaces the SDK result cause and classifies it as a query failure", async () => {
    const [{ ClaudeSdkOauthSessionRegistry, overrideSessionRegistryBoundary, resetSessionRegistryBoundary }, { submitSessionTurn }, { sanitizeTerminalFailure }] = await Promise.all([
      import(`${senpiRoot}/session-registry.js`),
      import(`${senpiRoot}/session-registry-pump.js`),
      import(`${senpiRoot}/session-observability.js`),
    ])
    const readers: Array<(value: IteratorResult<never>) => void> = []
    const query = {
      [Symbol.asyncIterator]() { return this },
      next() { return new Promise<IteratorResult<never>>((resolve) => readers.push(resolve)) },
      async interrupt() {},
      close() {},
    }
    const emit = (message: never) => readers.shift()?.({ value: message, done: false })

    overrideSessionRegistryBoundary({ queryFactory: () => query })
    try {
      const registry = new ClaudeSdkOauthSessionRegistry()
      const entry = registry.getOrCreate({
        senpiSessionId: "result-before-replay",
        accountName: "default",
        modelId: "claude-test",
        toolsetHash: "tools",
        systemPromptHash: "prompt",
        options: {},
      })
      const turn = submitSessionTurn(registry, entry, { message: { role: "user", content: "hello" } })
      await entry.inputController[Symbol.asyncIterator]().next()
      const result = {
        type: "result",
        subtype: "error_during_execution",
        errors: ["All Claude accounts are exhausted"],
        result: "All Claude accounts are exhausted",
        uuid: "result",
        session_id: entry.sdkSessionId,
      } as never
      emit(result)

      const error = await turn.then(() => undefined, (value: Error) => value)
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toContain("All Claude accounts are exhausted")
      expect(sanitizeTerminalFailure(error)).toBe("query_failed")
      expect(entry.activeTurn).toBeNull()
    } finally {
      resetSessionRegistryBoundary()
    }
  })
})
