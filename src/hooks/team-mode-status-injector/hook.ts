import type { TeamModeConfig } from "../../config/schema/team-mode"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  role: string
  sessionID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type TeamModeStatusInjectorInput = {
  sessionID?: string
  [key: string]: unknown
}

type TeamModeStatusInjectorOutput = {
  messages: MessageWithParts[]
}

export type TeamModeStatusInjectorHook = {
  "experimental.chat.messages.transform"?: (
    input: TeamModeStatusInjectorInput,
    output: TeamModeStatusInjectorOutput,
  ) => Promise<void>
}

const TEAM_MODE_STATUS_MARKER = "<team_mode_status enabled=\"true\">"

function resolveSessionID(
  input: TeamModeStatusInjectorInput,
  messages: MessageWithParts[],
): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionID = messages[index]?.info.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }
  }

  return undefined
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info.role === "user") {
      return index
    }
  }

  return -1
}

function hasInjectedTeamModeStatus(messages: MessageWithParts[]): boolean {
  return messages.some((message) =>
    message.parts.some(
      (part) => part.synthetic === true && part.type === "text" && part.text?.includes(TEAM_MODE_STATUS_MARKER),
    ),
  )
}

function buildTeamModeStatusContent(): string {
  return `${TEAM_MODE_STATUS_MARKER}
Team mode is ENABLED for this session.
If the team_* tools are present, that is authoritative proof that team mode is active.
Do not inspect ~/.config/opencode or project config files to verify team mode.
If you need usage guidance, load the team-mode skill. Otherwise use the team_* tools directly.
</team_mode_status>`
}

function createInjectedMessage(sessionID: string): MessageWithParts {
  return {
    info: {
      role: "user",
      sessionID,
    },
    parts: [{ type: "text", text: buildTeamModeStatusContent(), synthetic: true }],
  }
}

export function createTeamModeStatusInjector(
  config: TeamModeConfig,
): TeamModeStatusInjectorHook {
  return {
    "experimental.chat.messages.transform": async (
      input,
      output,
    ): Promise<void> => {
      if (!config.enabled || output.messages.length === 0) {
        return
      }

      if (hasInjectedTeamModeStatus(output.messages)) {
        return
      }

      const sessionID = resolveSessionID(input, output.messages)
      if (sessionID === undefined) {
        return
      }

      const lastUserMessageIndex = findLastUserMessageIndex(output.messages)
      const injectedMessage = createInjectedMessage(sessionID)

      if (lastUserMessageIndex === -1) {
        output.messages.unshift(injectedMessage)
        return
      }

      output.messages.splice(lastUserMessageIndex, 0, injectedMessage)
    },
  }
}
