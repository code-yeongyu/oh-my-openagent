/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { HOST_DENIAL_REPLACEMENT_TEXT, HOST_TOOL_DENIAL_LEAK_TEXT } from "./constants"
import { createHostDenialGuardComponent } from "./index"
import { sanitizeAgentMessage, sanitizeDenialLeakText } from "./sanitize"

function textBlock(text: string): Record<string, unknown> {
  return { type: "text", text }
}

function assistantMessage(content: unknown[]): Record<string, unknown> {
  return { role: "assistant", content }
}

function toolResultMessage(content: unknown[]): Record<string, unknown> {
  return { role: "toolResult", toolCallId: "tool-1", toolName: "read", isError: false, content }
}

function userMessage(content: unknown[]): Record<string, unknown> {
  return { role: "user", content }
}

function messageEndPayload(message: unknown): Record<string, unknown> {
  return { type: "message_end", message }
}

const fakeComponentContext: ComponentContext = {
  logger: {
    info() {},
    warn() {},
    error() {},
  },
  config: {
    getFlag: () => undefined,
  },
}

async function dispatchMessageEnd(payload: unknown): Promise<unknown[]> {
  const pi = new FakeExtensionAPI()
  createHostDenialGuardComponent().register(pi, fakeComponentContext)
  return pi.dispatch("message_end", payload)
}

function readInstalledSenpiToolsJs(): string {
  const entry = Bun.resolveSync("@code-yeongyu/senpi", import.meta.dir)
  return readFileSync(join(dirname(entry), "core/extensions/builtin/claude-sdk-oauth/tools.js"), "utf8")
}

describe("host-denial-guard", () => {
  describe("#given an assistant reply echoing the host denial instruction", () => {
    test("#when the host finalizes the message #then the replacement carries no denial text and keeps the role", async () => {
      // given
      const payload = messageEndPayload(
        assistantMessage([textBlock(`I could not run that directly. ${HOST_TOOL_DENIAL_LEAK_TEXT} Anything else?`)]),
      )

      // when
      const results = await dispatchMessageEnd(payload)

      // then
      expect(results).toHaveLength(1)
      const result = results[0] as { message?: { role: string; content: Array<{ type: string; text?: string }> } }
      expect(result.message).toBeDefined()
      expect(result.message?.role).toBe("assistant")
      const serialized = JSON.stringify(result.message)
      expect(serialized).not.toContain(HOST_TOOL_DENIAL_LEAK_TEXT)
      expect(serialized).toContain(HOST_DENIAL_REPLACEMENT_TEXT)
      expect(result.message?.content[0]?.text).toContain("Anything else?")
    })
  })

  describe("#given sanitizeDenialLeakText", () => {
    test("#when the literal sits mid-sentence or repeats #then only the literal is swapped and surroundings survive", () => {
      // given
      const once = `prefix ${HOST_TOOL_DENIAL_LEAK_TEXT} suffix`
      const twice = `${HOST_TOOL_DENIAL_LEAK_TEXT}\n${HOST_TOOL_DENIAL_LEAK_TEXT}`

      // when
      const sanitizedOnce = sanitizeDenialLeakText(once)
      const sanitizedTwice = sanitizeDenialLeakText(twice)

      // then
      expect(sanitizedOnce).toBe(`prefix ${HOST_DENIAL_REPLACEMENT_TEXT} suffix`)
      expect(sanitizedTwice).not.toContain(HOST_TOOL_DENIAL_LEAK_TEXT)
      expect(sanitizedTwice.split(HOST_DENIAL_REPLACEMENT_TEXT)).toHaveLength(3)
    })

    test("#when the text never contained the literal #then it comes back unchanged", () => {
      // given
      const clean = "plain assistant prose"

      // when
      const sanitized = sanitizeDenialLeakText(clean)

      // then
      expect(sanitized).toBe(clean)
    })
  })

  describe("#given messages that must pass through untouched", () => {
    test("#when content is clean or the role is user #then no replacement is returned", async () => {
      // given
      const cleanAssistant = messageEndPayload(assistantMessage([textBlock("all good")]))
      const cleanToolResult = messageEndPayload(toolResultMessage([textBlock("file contents")]))
      const leakingUser = messageEndPayload(userMessage([textBlock(HOST_TOOL_DENIAL_LEAK_TEXT)]))

      // when
      const [assistantResult, toolResultResult, userResult] = await Promise.all([
        dispatchMessageEnd(cleanAssistant),
        dispatchMessageEnd(cleanToolResult),
        dispatchMessageEnd(leakingUser),
      ])

      // then
      expect(assistantResult).toHaveLength(1)
      expect(assistantResult[0]).toBeUndefined()
      expect(toolResultResult).toHaveLength(1)
      expect(toolResultResult[0]).toBeUndefined()
      expect(userResult).toHaveLength(1)
      expect(userResult[0]).toBeUndefined()
    })
  })

  describe("#given a sanitized turn followed by another tool turn", () => {
    test("#when the later-turn history is composed #then the denial instruction appears nowhere", () => {
      // given
      const leakedTurn = assistantMessage([textBlock(HOST_TOOL_DENIAL_LEAK_TEXT)])
      const sanitizedTurn = sanitizeAgentMessage(leakedTurn)?.message

      // when
      const laterTurnHistory = [
        sanitizedTurn,
        toolResultMessage([textBlock("real host tool output")]),
        assistantMessage([textBlock("continuing the next tool turn")]),
      ]

      // then
      expect(JSON.stringify([leakedTurn])).toContain(HOST_TOOL_DENIAL_LEAK_TEXT)
      expect(sanitizedTurn).toBeDefined()
      expect(JSON.stringify(laterTurnHistory)).not.toContain(HOST_TOOL_DENIAL_LEAK_TEXT)
    })
  })

  describe("#given malformed message_end payloads", () => {
    test("#when the payload shape is unexpected #then the guard stays silent", async () => {
      // given
      const payloads = [undefined, {}, messageEndPayload(undefined), messageEndPayload({ role: "assistant" })]

      // when
      const results = await Promise.all(payloads.map((payload) => dispatchMessageEnd(payload)))

      // then
      for (const result of results) {
        expect(result).toHaveLength(1)
        expect(result[0]).toBeUndefined()
      }
    })
  })

  test("#given the installed senpi runtime #when its dist declares the denial literal #then it matches our pinned constant", () => {
    // given
    const toolsJs = readInstalledSenpiToolsJs()

    // when
    const match = /HOST_TOOL_EXECUTION_DENIED_MESSAGE\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(toolsJs)

    // then
    expect(match).not.toBeNull()
    expect(JSON.parse(`"${match?.[1]}"`)).toBe(HOST_TOOL_DENIAL_LEAK_TEXT)
  })
})
