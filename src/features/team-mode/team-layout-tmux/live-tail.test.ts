/// <reference types="bun-types" />

import { describe, expect, test, beforeEach } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { _resetCacheForTests, buildLiveTailCommand, materializeLiveTailScript } from "./live-tail"

describe("buildLiveTailCommand", () => {
  beforeEach(() => {
    _resetCacheForTests()
  })

  test("emits a python invocation with shell-quoted args", () => {
    const cmd = buildLiveTailCommand("http://127.0.0.1:4096", "ses_abc123")
    expect(cmd).toContain("python3 -u ")
    expect(cmd).toContain("'http://127.0.0.1:4096'")
    expect(cmd).toContain("'ses_abc123'")
    expect(cmd).not.toContain("opencode attach")
  })

  test("escapes single quotes in url and session id", () => {
    const cmd = buildLiveTailCommand("http://x.test/'evil", "ses_'evil")
    expect(cmd).not.toMatch(/'\s'evil/)
    expect(cmd.split("'").length).toBeGreaterThan(4)
  })

  test("appends --insecure only when explicitly enabled", () => {
    const strictCmd = buildLiveTailCommand("https://127.0.0.1:4096", "ses_strict")
    const insecureCmd = buildLiveTailCommand("https://127.0.0.1:4096", "ses_insecure", { allowInsecureTls: true })
    expect(strictCmd).not.toContain(" --insecure")
    expect(insecureCmd).toContain(" --insecure")
  })

  test("appends --no-footer when disableStatusFooter is true", () => {
    const cmd = buildLiveTailCommand("http://x", "ses_y", { disableStatusFooter: true })
    expect(cmd).toContain(" --no-footer")
  })

  test("omits --no-footer when disableStatusFooter is false or absent", () => {
    const cmdDefault = buildLiveTailCommand("http://x", "ses_y")
    const cmdFalse = buildLiveTailCommand("http://x", "ses_y", { disableStatusFooter: false })
    expect(cmdDefault).not.toContain("--no-footer")
    expect(cmdFalse).not.toContain("--no-footer")
  })

  test("references a file that materialize wrote with python content", () => {
    const cmd = buildLiveTailCommand("http://127.0.0.1:4096", "ses_abc123")
    const match = cmd.match(/python3 -u '([^']+)'/)
    expect(match).not.toBeNull()
    const path = match![1]!
    expect(existsSync(path)).toBe(true)
    const contents = readFileSync(path, "utf8")
    expect(contents).toContain("Live-tail an OpenCode session")
    expect(contents).toContain("/event")
  })

  test("materializeLiveTailScript writes 0700 mode and is idempotent", () => {
    const path1 = materializeLiveTailScript()
    const path2 = materializeLiveTailScript()
    expect(path1).toBe(path2)
    const mode = statSync(path1).mode & 0o777
    expect(mode).toBe(0o700)
  })

  test("materialized script ends with a newline so python parses it cleanly", () => {
    const path = materializeLiveTailScript()
    const contents = readFileSync(path, "utf8")
    expect(contents.endsWith("\n")).toBe(true)
  })

  test("materialized script declares the expected helper functions for renderer logic", () => {
    // Smoke check that protects against accidentally bundling a stale script.
    const path = materializeLiveTailScript()
    const contents = readFileSync(path, "utf8")
    for (const symbol of [
      "def extract_task_line(",
      "def summarize_peer_message(",
      "class SessionState",
      "def render_banner(",
      "_KICKOFF_META_PREFIXES",
    ]) {
      expect(contents).toContain(symbol)
    }
  })
})
