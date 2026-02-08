const VALID_NAME_RE = /^[A-Za-z0-9_-]+$/
const MAX_NAME_LENGTH = 64

function validateName(value: string, label: "team" | "agent"): string | null {
  if (!value || !value.trim()) {
    return `${label}_name_required`
  }

  if (!VALID_NAME_RE.test(value)) {
    return `${label}_name_invalid`
  }

  if (value.length > MAX_NAME_LENGTH) {
    return `${label}_name_too_long`
  }

  return null
}

export function validateTeamName(teamName: string): string | null {
  return validateName(teamName, "team")
}

export function validateAgentName(agentName: string): string | null {
  if (agentName === "team-lead") {
    return "agent_name_reserved"
  }
  return validateName(agentName, "agent")
}
