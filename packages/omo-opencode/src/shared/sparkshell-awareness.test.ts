import { describe, expect, test } from "bun:test"

import {
  getSparkShellRuntimeAwareness,
  isCodexAppServerActive,
} from "./sparkshell-awareness"

describe("sparkshell runtime awareness", () => {
  test("#given Codex Desktop originator env #when detecting app server activation #then returns active", () => {
    // given
    const env = {
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
      CODEX_SHELL: "1",
    }

    // when
    const active = isCodexAppServerActive(env)

    // then
    expect(active).toBe(true)
  })

  test("#given inactive environment #when resolving runtime awareness #then returns empty context", () => {
    // given
    const env = {
      CODEX_SHELL: "1",
    }

    // when
    const context = getSparkShellRuntimeAwareness(env)

    // then
    expect(context).toBe("")
  })

  test("#given Codex CLI appserver socket env #when resolving runtime awareness #then returns Sparkshell guidance", () => {
    // given
    const env = {
      OMO_SPARKSHELL_APP_SERVER_SOCKET: "/tmp/app-server-control.sock",
      CODEX_THREAD_ID: "thread-sparkshell-cli",
    }

    // when
    const context = getSparkShellRuntimeAwareness(env)

    // then
    expect(context).toContain("omo sparkshell <command>")
    expect(context).toContain("repo inspection")
  })

  test("#given explicit force-off env #when Codex Desktop is present #then returns empty context", () => {
    // given
    const env = {
      OMO_SPARKSHELL_AWARENESS: "0",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
      CODEX_SHELL: "1",
    }

    // when
    const context = getSparkShellRuntimeAwareness(env)

    // then
    expect(context).toBe("")
  })

  test("#given explicit force-on env #when Codex Desktop is absent #then returns Sparkshell guidance", () => {
    // given
    const env = {
      OMO_SPARKSHELL_AWARENESS: "1",
    }

    // when
    const context = getSparkShellRuntimeAwareness(env)

    // then
    expect(context).toContain("omo sparkshell <command>")
    expect(context).toContain("Prefer")
    expect(context).toContain("CLI smoke tests")
    expect(context).toContain("--tmux-pane")
    expect(context).toContain("OMO_SPARKSHELL_BIN")
    expect(context).toContain("OMO_SPARKSHELL_SESSION_CONTEXT")
    expect(context).toContain("OMO_SPARKSHELL_CONDENSE")
    expect(context).toContain("OMO_SPARKSHELL_SPARK")
    expect(context).toContain("[sparkshell caption]")
    expect(context).not.toContain("[REDACTED]")
    expect(context).toContain("log")
  })
})
