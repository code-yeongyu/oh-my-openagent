import { describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"

describe("OpenCode Sparkshell awareness system transform", () => {
  test("#given active Codex app server env #when system transform runs #then appends Sparkshell guidance", async () => {
    // given
    const handler = createSystemTransformHandler(
      undefined,
      undefined,
      {
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
        CODEX_SHELL: "1",
      },
    )
    const output = { system: ["base system prompt"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-active",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system.join("\n")).toContain("omo sparkshell <command>")
  })

  test("#given inactive env #when system transform runs #then leaves system prompt unchanged", async () => {
    // given
    const handler = createSystemTransformHandler(undefined, undefined, {})
    const output = { system: ["base system prompt"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-inactive",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system).toEqual(["base system prompt"])
  })

  test("#given Codex CLI appserver socket env #when system transform runs #then appends Sparkshell guidance", async () => {
    // given
    const handler = createSystemTransformHandler(undefined, undefined, {
      OMO_SPARKSHELL_APP_SERVER_SOCKET: "/tmp/app-server-control.sock",
      CODEX_THREAD_ID: "thread-sparkshell-cli",
    })
    const output = { system: ["base system prompt"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-cli-wrapper",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system.join("\n")).toContain("omo sparkshell <command>")
  })

  test("#given explicit force-on env #when system transform runs #then appends Sparkshell guidance", async () => {
    // given
    const handler = createSystemTransformHandler(undefined, undefined, {
      OMO_SPARKSHELL_AWARENESS: "1",
    })
    const output = { system: ["base system prompt"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-force-on",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system.join("\n")).toContain("omo sparkshell <command>")
  })

  test("#given explicit force-off env with active Codex app context #when system transform runs #then leaves system prompt unchanged", async () => {
    // given
    const handler = createSystemTransformHandler(undefined, undefined, {
      OMO_SPARKSHELL_AWARENESS: "0",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
      CODEX_SHELL: "1",
    })
    const output = { system: ["base system prompt"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-force-off",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system).toEqual(["base system prompt"])
  })

  test("#given preexisting Sparkshell marker #when system transform runs #then does not duplicate guidance", async () => {
    // given
    const handler = createSystemTransformHandler(
      undefined,
      undefined,
      {
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
        CODEX_SHELL: "1",
      },
    )
    const output = { system: ["## Sparkshell Runtime\n\nexisting guidance"] }

    // when
    await handler(
      {
        sessionID: "session-sparkshell-dedupe",
        model: { id: "gpt-5.5", providerID: "openai" },
      },
      output,
    )

    // then
    expect(output.system).toEqual(["## Sparkshell Runtime\n\nexisting guidance"])
  })
})
