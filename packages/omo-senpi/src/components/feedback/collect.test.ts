import { describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { blankConfigSecrets, engineLogText, transcriptText } from "./collect"

describe("blankConfigSecrets", () => {
  test("#given provider headers, api keys and nested tokens in a config #when it is prepared for a report #then their values are blanked while the shape and safe values stay", () => {
    const config = {
      model: "anthropic/claude-opus-5-5",
      provider: {
        custom: {
          baseURL: "https://user:pass@llm.example.test/v1",
          apiKey: "sk-live-abc",
          headers: { "x-org": "acme", authorization: "Bearer zzz" },
          options: { timeout: 30 },
        },
      },
      mcp: { github: { env: { GITHUB_TOKEN: "ghp_x" }, command: "gh-mcp" } },
    }

    const blanked = blankConfigSecrets(config)

    expect(blanked).toEqual({
      model: "anthropic/claude-opus-5-5",
      provider: {
        custom: {
          baseURL: "https://<redacted>@llm.example.test/v1",
          apiKey: "<redacted>",
          headers: { "x-org": "<redacted>", authorization: "<redacted>" },
          options: { timeout: 30 },
        },
      },
      mcp: { github: { env: { GITHUB_TOKEN: "<redacted>" }, command: "gh-mcp" } },
    })
  })

  test("#given budget settings and a bare key field #when a config is prepared #then token limits stay readable and the key is blanked", () => {
    expect(blankConfigSecrets({ max_tokens: 4096, maxTokens: 2048, context_token_limit: 200000, key: "abc", refreshToken: "r", accessToken: "a" })).toEqual({
      max_tokens: 4096,
      maxTokens: 2048,
      context_token_limit: 200000,
      key: "<redacted>",
      refreshToken: "<redacted>",
      accessToken: "<redacted>",
    })
  })
})

describe("transcriptText", () => {
  const entry = (role: string, text: string, timestamp = "2026-10-19T02:09:51.000Z") => ({
    type: "message",
    timestamp,
    message: { role, content: [{ type: "text", text }] },
  })

  test("#given a long session #when the transcript is collected #then only the last 50 messages are kept, oldest first", () => {
    const entries = Array.from({ length: 70 }, (_, index) => entry("user", `message ${index}`))

    const lines = transcriptText(entries).split("\n")

    expect(lines).toHaveLength(50)
    expect(lines[0]).toContain("message 20")
    expect(lines.at(-1)).toContain("message 69")
  })

  test("#given a huge tool result #when the transcript is collected #then its head and tail stay and the middle is marked as cut", () => {
    const big = `${"A".repeat(3000)}MIDDLE${"Z".repeat(3000)}`
    const text = transcriptText([entry("toolResult", big)])

    expect(text).toContain("AAAA")
    expect(text).toContain("ZZZZ")
    expect(text).not.toContain("MIDDLE")
    expect(text).toMatch(/\[\d+ characters cut\]/)
  })

  test("#given a multi-line message with a token on one line #when the transcript is collected #then only that line loses its value", () => {
    const text = transcriptText([entry("toolResult", "token=abc123\nworkdir ~/projects/demo ok")])

    expect(text.split("\n")).toEqual([expect.stringContaining("token=abc123"), "  workdir ~/projects/demo ok"])
  })

  test("#given entries that are not messages #when the transcript is collected #then they are left out", () => {
    const text = transcriptText([
      { type: "custom", customType: "memory", data: { secret: "memory body" } },
      entry("assistant", "done"),
    ])

    expect(text).not.toContain("memory body")
    expect(text).toContain("assistant")
    expect(text).toContain("done")
  })
})

describe("engineLogText", () => {
  const dirs: string[] = []
  const agentDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-feedback-logs-"))
    dirs.push(dir)
    mkdirSync(join(dir, "logs"))
    return dir
  }
  const cleanup = () => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  }

  test("#given engine logs with old and recent lines #when they are collected #then only the last 15 minutes of each log come back, named by file", () => {
    const dir = agentDir()
    const now = new Date("2026-10-19T03:00:00.000Z")
    writeFileSync(
      join(dir, "logs", "fallback.log"),
      [
        JSON.stringify({ ts: "2026-10-19T02:00:00.000Z", event: "fallback_applied", reason: "old" }),
        JSON.stringify({ ts: "2026-10-19T02:50:00.000Z", event: "fallback_applied", reason: "refusal" }),
      ].join("\n"),
    )
    writeFileSync(join(dir, "logs", "session.log"), `${JSON.stringify({ ts: "2026-10-19T02:59:00.000Z", level: "error", event: "turn_failed" })}\n`)
    writeFileSync(join(dir, "logs", "session.log.1"), `${JSON.stringify({ ts: "2026-10-19T02:59:30.000Z", event: "rotated" })}\n`)

    const text = engineLogText(dir, now)

    expect(text).toContain("refusal")
    expect(text).toContain("turn_failed")
    expect(text).not.toContain("\"old\"")
    expect(text).not.toContain("rotated")
    expect(text).toContain("## fallback.log")
    cleanup()
  })

  test("#given a log line that carries conversation content #when logs are collected #then the line is dropped, because the conversation goes only in its own section", () => {
    const dir = agentDir()
    const now = new Date("2026-10-19T03:00:00.000Z")
    writeFileSync(
      join(dir, "logs", "session.log"),
      [
        JSON.stringify({ ts: "2026-10-19T02:59:00.000Z", event: "prompt", content: "another session's private text" }),
        JSON.stringify({ ts: "2026-10-19T02:59:10.000Z", event: "turn_ok" }),
      ].join("\n"),
    )

    const text = engineLogText(dir, now)

    expect(text).not.toContain("private text")
    expect(text).toContain("turn_ok")
    cleanup()
  })

  test("#given log lines with content nested, in arrays or under logger keys #when logs are collected #then only allowlisted fields of each line are kept", () => {
    const dir = agentDir()
    const now = new Date("2026-10-19T03:00:00.000Z")
    writeFileSync(
      join(dir, "logs", "session.log"),
      [
        JSON.stringify({ ts: "2026-10-19T02:59:00.000Z", level: "info", event: "turn", data: { text: "NESTED-SECRET-TEXT" } }),
        JSON.stringify({ ts: "2026-10-19T02:59:01.000Z", level: "info", event: "turn", messages: ["ARRAY-TEXT"] }),
        JSON.stringify({ ts: "2026-10-19T02:59:02.000Z", level: "warn", msg: "MSG-TEXT", query: "QUERY-TEXT", cwd: "/private/cwd", error: { message: "ERROR-TEXT", name: "TypeError" } }),
        JSON.stringify({ ts: "2026-10-19T02:59:03.000Z", level: "error", event: "turn_failed", durationMs: 31400, reason: "tool_timeout" }),
      ].join("\n"),
    )

    const text = engineLogText(dir, now)

    for (const leaked of ["NESTED-SECRET-TEXT", "ARRAY-TEXT", "MSG-TEXT", "QUERY-TEXT", "/private/cwd", "ERROR-TEXT"]) expect(text).not.toContain(leaked)
    expect(text).toContain("turn_failed")
    expect(text).toContain("tool_timeout")
    expect(text).toContain("31400")
    cleanup()
  })

  test("#given no logs directory #when logs are collected #then nothing is returned", () => {
    expect(engineLogText(join(tmpdir(), "omo-feedback-missing-dir"), new Date())).toBe("")
  })
})
