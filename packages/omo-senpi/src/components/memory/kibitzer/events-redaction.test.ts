import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createKibitzerEventStream, DEFAULT_KIBITZER_EVENT_CAPS, KIBITZER_EVENT_BUFFER_SIZE, redactKibitzerEventText, renderKibitzerEventBatch } from "./events"
import { redactSensitiveOutput, redactSensitiveTokenValues } from "./sensitive-output"

// senpi does not export core/sensitive-output from its package entry, so the sidecar carries a
// mirror; this import reaches the real dist module the same way senpi-test-runtime.ts does.
const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const senpiSensitiveOutput = await import(pathToFileURL(join(senpiDistDir, "core", "sensitive-output.js")).href) as {
  redactSensitiveOutput(text: string): string
  redactSensitiveTokenValues(text: string, replacement?: string): string
}

const API_KEY = "sk-live-0123456789abcdef0123456789"
const BEARER = "secret-token-value-9f8e7d6c"
const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

function toolCall(toolName: string, input: Record<string, unknown>, toolCallId = "call-1"): unknown {
  return { type: "tool_call", toolCallId, toolName, input }
}

function toolResult(toolName: string, text: string, toolCallId = "call-1"): unknown {
  return { type: "tool_result", toolCallId, toolName, input: {}, content: [{ type: "text", text }], isError: false }
}

function branchOf(length: number): unknown[] {
  return Array.from({ length }, (_, index) => ({ type: "message", message: { role: "user", content: `turn ${index}` } }))
}

describe("kibitzer event redaction", () => {
  test("#given a 90KB eval and an API key in its result #when captured and folded #then it redacts 90KB eval and API key before storage", () => {
    const stream = createKibitzerEventStream()
    const code = `export OPENAI_API_KEY=${API_KEY}\n${"await Bun.$`bun test`.text();\n".repeat(3_200)}export AGAIN_API_KEY=${API_KEY}\n`
    expect(code.length).toBeGreaterThan(90_000)
    const output = `Authorization: Bearer ${BEARER}\n${GITHUB_TOKEN}\n${"ok\n".repeat(500)}`

    expect(stream.onToolCall(toolCall("eval", { language: "js", code }), branchOf(1))).toBe(true)
    expect(stream.onToolResult(toolResult("eval", output), branchOf(1))).toBe(true)

    const [callEvent, resultEvent] = stream.peek().events
    expect(callEvent?.body.length).toBeLessThanOrEqual(DEFAULT_KIBITZER_EVENT_CAPS.toolArgs)
    expect(callEvent?.body).not.toContain(API_KEY)
    expect(callEvent?.body).toMatch(/\*\*\*|\[REDACTED\]/)
    expect(resultEvent?.body.length).toBeLessThanOrEqual(DEFAULT_KIBITZER_EVENT_CAPS.resultHead)
    expect(resultEvent?.body).not.toContain(BEARER)
    expect(resultEvent?.body).not.toContain(GITHUB_TOKEN)
    expect(resultEvent?.body).toContain("[REDACTED]")

    for (let index = 0; index < KIBITZER_EVENT_BUFFER_SIZE; index += 1) stream.onToolCall(toolCall("read", { path: `file-${index}.ts` }, `call-${index}`), branchOf(2 + index))

    const batch = stream.peek()
    const serialized = JSON.stringify(batch)
    const rendered = renderKibitzerEventBatch(batch)
    expect(batch.digest?.count).toBe(2)
    for (const surface of [serialized, rendered, batch.digest?.line ?? ""]) {
      expect(surface).not.toContain(API_KEY)
      expect(surface).not.toContain(BEARER)
      expect(surface).not.toContain(GITHUB_TOKEN)
      expect(surface).not.toContain("bun test`.text();\n".repeat(30))
    }
    expect(serialized.length).toBeLessThan(10_000)
  })

  test("#given a token that straddles the truncation boundary #when captured #then redaction happened before truncation", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"
    // `{"command":"` is 12 characters; the token starts at 383 and would be cut to 17 characters by a
    // truncate-first implementation, too short for the 20-character token pattern to fire afterwards.
    const fitting = createKibitzerEventStream()
    expect(fitting.onToolCall(toolCall("bash", { command: `${"x".repeat(370)} ${token}` }), branchOf(1))).toBe(true)
    const [fits] = fitting.peek().events
    expect(fits?.body).not.toContain("ghp_")
    expect(fits?.body).toContain("[REDACTED]")
    expect(fits?.truncated).toBe(false)

    // The same token starting at 392: once redacted the text still exceeds the cap and is cut.
    const overflowing = createKibitzerEventStream()
    expect(overflowing.onToolCall(toolCall("bash", { command: `${"x".repeat(379)} ${token}` }), branchOf(1))).toBe(true)
    const [cut] = overflowing.peek().events
    expect(cut?.body).not.toContain("ghp_")
    expect(cut?.truncated).toBe(true)
    expect(cut?.body.length).toBe(DEFAULT_KIBITZER_EVENT_CAPS.toolArgs)
  })

  test("#given a bare project key inside JSON tool input #when captured #then the memory-core mask removes it", () => {
    const stream = createKibitzerEventStream()

    expect(stream.onToolCall(toolCall("http", { apiKey: "sk-proj-abcDEF123_456", url: "https://deploy:hunter2@example.com/x" }), branchOf(1))).toBe(true)

    expect(stream.peek().events[0]?.body).toBe('{"apiKey":"***","url":"https://***:***@example.com/x"}')
  })

  test("#given a prompt carrying a PEM block and an env-style key #when captured #then neither survives in the stored prompt", () => {
    const stream = createKibitzerEventStream()
    const stripeKey = `sk_${"test"}_${"z".repeat(24)}`
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----"

    expect(stream.onPrompt({ type: "before_agent_start", prompt: `here is my key ${pem} and STRIPE_SECRET=${stripeKey}` }, branchOf(1))).toBe(true)

    const [event] = stream.peek().events
    expect(event?.body).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7")
    expect(event?.body).not.toContain(stripeKey)
    expect(event?.body).toContain("here is my key")
  })

  test("#given the event redaction pipeline #when run over mixed material #then senpi and memory-core masks both apply", () => {
    const redacted = redactKibitzerEventText(`Authorization: Bearer ${BEARER} ${GITHUB_TOKEN} https://user:pw@host/x plain text`)

    expect(redacted).not.toContain(BEARER)
    expect(redacted).not.toContain(GITHUB_TOKEN)
    expect(redacted).toContain("[REDACTED]")
    expect(redacted).toContain("https://***:***@host/x")
    expect(redacted).toContain("plain text")
  })

  test.each([
    "OPENAI_API_KEY=sk-live-abc123 MY_SECRET=hunter2 SESSION_TOKEN=abc DB_PASSWORD=pw BASIC_AUTH=z",
    "Authorization: Bearer eyJabc.def and authorization: bearer lower-case",
    "Bearer sk-abcdef-ghi and Bearer notsk-abc",
    `token ${GITHUB_TOKEN} pat github_pat_11ABCDEFG0123456789_abcdefghij short ghp_short`,
    "multi\nline OPENAI_API_KEY=first\nline two PASSWORD=second\n",
    "",
    "key=value lowercase_api_key=stays FOO_API_KEY=\"quoted\" FOO_API_KEY='single'",
    "trailing punctuation ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789. and (github_pat_ABCDEFGHIJKLMNOPQRSTUV_x)",
  ])("#given the senpi core/sensitive-output module #when both redactors run over %j #then outputs are identical", (input) => {
    expect(redactSensitiveOutput(input)).toBe(senpiSensitiveOutput.redactSensitiveOutput(input))
    expect(redactSensitiveTokenValues(input)).toBe(senpiSensitiveOutput.redactSensitiveTokenValues(input))
    expect(redactSensitiveTokenValues(input, "<gone>")).toBe(senpiSensitiveOutput.redactSensitiveTokenValues(input, "<gone>"))
  })
})
