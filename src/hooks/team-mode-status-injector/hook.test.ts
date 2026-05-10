import { describe, expect, it } from "bun:test"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import { createTeamModeStatusInjector } from "./hook"

function createOutput(sessionID: string): {
  messages: Array<{
    info: { role: string; sessionID: string }
    parts: Array<{ type: string; text?: string; synthetic?: boolean }>
  }>
} {
  return {
    messages: [
      {
        info: {
          role: "user",
          sessionID,
        },
        parts: [{ type: "text", text: "original message" }],
      },
    ],
  }
}

describe("createTeamModeStatusInjector", () => {
  it("injects a one-time team mode enabled message before the latest user message", async () => {
    // given
    const hook = createTeamModeStatusInjector(TeamModeConfigSchema.parse({ enabled: true }))
    const output = createOutput("session-team-mode")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-team-mode" },
      output,
    )

    // then
    expect(output.messages).toHaveLength(2)
    expect(output.messages[0]).toEqual({
      info: {
        role: "user",
        sessionID: "session-team-mode",
      },
      parts: [
        {
          type: "text",
          text: expect.stringContaining("Team mode is ENABLED for this session."),
          synthetic: true,
        },
      ],
    })
    expect(output.messages[1]?.parts[0]?.text).toBe("original message")
  })

  it("does not inject again when the team mode status was already added", async () => {
    // given
    const hook = createTeamModeStatusInjector(TeamModeConfigSchema.parse({ enabled: true }))
    const firstOutput = createOutput("session-team-mode")
    const secondOutput = createOutput("session-team-mode")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-team-mode" },
      firstOutput,
    )
    secondOutput.messages = structuredClone(firstOutput.messages)
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-team-mode" },
      secondOutput,
    )

    // then
    expect(firstOutput.messages).toHaveLength(2)
    expect(secondOutput.messages).toHaveLength(2)
    expect(
      secondOutput.messages.filter((message) =>
        message.parts.some((part) => part.text?.includes("<team_mode_status enabled=\"true\">")),
      ),
    ).toHaveLength(1)
  })

  it("does nothing when team mode is disabled", async () => {
    // given
    const hook = createTeamModeStatusInjector(TeamModeConfigSchema.parse({ enabled: false }))
    const output = createOutput("session-team-mode")

    // when
    await hook["experimental.chat.messages.transform"]?.(
      { sessionID: "session-team-mode" },
      output,
    )

    // then
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0]?.parts[0]?.text).toBe("original message")
  })
})
