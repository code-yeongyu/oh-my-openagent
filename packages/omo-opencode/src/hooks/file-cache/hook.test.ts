import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, test, afterEach } from "bun:test"
import { createFileCacheHook } from "./hook"
import { _resetForTesting, getCache, getSessionEntries } from "./file-cache-store"
import type { OhMyOpenCodeConfig } from "../../config"
import { createHash } from "node:crypto"

describe("file-cache hook", () => {
  afterEach(() => {
    _resetForTesting()
  })

  function mockPluginInput() {
    return {
      directory: "/fake/dir",
      client: {},
    } as unknown as PluginInput
  }

  function mockConfig(): OhMyOpenCodeConfig {
    return {} as OhMyOpenCodeConfig
  }

  test("should cache file read and replace output with marker", async () => {
    const ctx = mockPluginInput()
    const config = mockConfig()
    const hook = createFileCacheHook(ctx, config)

    const sessionID = "ses-1"
    const filePath = "/fake/dir/src/index.ts"
    const fileContent = "console.log('hello');"

    const input = { tool: "read", sessionID, callID: "c1" }
    const output = { title: filePath, output: fileContent, metadata: {} }

    // Execute messages.transform first to register/track turn number 0
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages: [] })

    await hook["tool.execute.after"](input, output)

    // Verify it is cached
    const cached = getCache(sessionID, filePath)
    expect(cached).toBeDefined()
    expect(cached?.content).toBe(fileContent)
    expect(cached?.lastUsedTurn).toBe(0)

    const expectedHash = createHash("sha256").update(fileContent).digest("hex")
    const expectedSize = Buffer.byteLength(fileContent, "utf8")
    expect(output.output).toBe(
      `[File Cache: ${filePath} (v${expectedHash}, ${expectedSize} bytes) - Cached in Virtual Memory. Refer to this file directly or edit it without re-reading.]`
    )
  })

  test("should rehydrate active file in messages.transform", async () => {
    const ctx = mockPluginInput()
    const config = mockConfig()
    const hook = createFileCacheHook(ctx, config)

    const sessionID = "ses-1"
    const filePath = "/fake/dir/src/index.ts"
    const fileContent = "console.log('hello');"
    const expectedHash = createHash("sha256").update(fileContent).digest("hex")
    const expectedSize = Buffer.byteLength(fileContent, "utf8")

    const marker = `[File Cache: ${filePath} (v${expectedHash}, ${expectedSize} bytes) - Cached in Virtual Memory. Refer to this file directly or edit it without re-reading.]`

    // Mock messages
    const messages = [
      { info: { role: "user", sessionID }, parts: [{ type: "text", text: "Read the file" }] },
      { info: { role: "assistant", sessionID }, parts: [{ type: "text", text: marker }] }
    ]

    // Initialize turn 2
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages })

    // Manually set cache entry
    const input = { tool: "read", sessionID, callID: "c1" }
    const output = { title: filePath, output: fileContent, metadata: {} }
    await hook["tool.execute.after"](input, output)

    // Now, run messages.transform on the history. Since we are at turn 2, and lastUsedTurn was set to 2, it is active (2 - 2 <= 2).
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages })

    expect(messages[1].parts[0].text).toBe(fileContent)
  })

  test("should NOT rehydrate and should dehydrate inactive file in messages.transform", async () => {
    const ctx = mockPluginInput()
    const config = mockConfig()
    const hook = createFileCacheHook(ctx, config)

    const sessionID = "ses-1"
    const filePath = "/fake/dir/src/index.ts"
    const fileContent = "console.log('hello');"
    const expectedHash = createHash("sha256").update(fileContent).digest("hex")
    const expectedSize = Buffer.byteLength(fileContent, "utf8")

    const marker = `[File Cache: ${filePath} (v${expectedHash}, ${expectedSize} bytes) - Cached in Virtual Memory. Refer to this file directly or edit it without re-reading.]`

    // Turn 0: tool execution (sets lastUsedTurn = 0)
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages: [] })
    const input = { tool: "read", sessionID, callID: "c1" }
    const output = { title: filePath, output: fileContent, metadata: {} }
    await hook["tool.execute.after"](input, output)

    // Now we are at turn 4 (messages length = 4). Turn diff: 4 - 0 = 4 > 2 (inactive)
    const messages = [
      { info: { role: "user", sessionID }, parts: [{ type: "text", text: "Old Read" }] },
      { info: { role: "assistant", sessionID }, parts: [{ type: "text", text: `<file>${filePath}</file>\n<content>\n${fileContent}\n</content>` }] },
      { info: { role: "user", sessionID }, parts: [{ type: "text", text: "Something else" }] },
      { info: { role: "assistant", sessionID }, parts: [{ type: "text", text: "Response" }] }
    ]

    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages })

    // It should be dehydrated
    expect(messages[1].parts[0].text).toBe(marker)
  })

  test("should mark file active on edit/write", async () => {
    const ctx = mockPluginInput()
    const config = mockConfig()
    const hook = createFileCacheHook(ctx, config)

    const sessionID = "ses-1"
    const filePath = "/fake/dir/src/index.ts"
    const fileContent = "console.log('hello');"

    // Turn 0: Read
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages: [] })
    const inputRead = { tool: "read", sessionID, callID: "c1" }
    const outputRead = { title: filePath, output: fileContent, metadata: {} }
    await hook["tool.execute.after"](inputRead, outputRead)

    expect(getCache(sessionID, filePath)?.lastUsedTurn).toBe(0)

    // Turn 4: Write (updates lastUsedTurn = 4)
    await hook["experimental.chat.messages.transform"]({ sessionID }, { messages: [{}, {}, {}, {}] })
    const inputWrite = { tool: "write", sessionID, callID: "c2" }
    const outputWrite = { title: filePath, output: "File written successfully.", metadata: { filePath } }
    await hook["tool.execute.after"](inputWrite, outputWrite)

    expect(getCache(sessionID, filePath)?.lastUsedTurn).toBe(4)
  })
})
