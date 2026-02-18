import type { CouncilConfig, CouncilMemberConfig } from "../../agents/athena/types"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE } from "./constants"

function isCouncilConfigured(councilConfig: CouncilConfig | undefined): councilConfig is CouncilConfig {
  return Boolean(councilConfig && councilConfig.members.length > 0)
}

interface FilterCouncilMembersResult {
  members: CouncilMemberConfig[]
  error?: string
}

function buildSingleMemberSelectionError(members: CouncilMemberConfig[]): string {
  const availableNames = members.map((member) => member.name ?? member.model).join(", ")
  return `athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: ${availableNames}.`
}

function filterCouncilMembers(
  members: CouncilMemberConfig[],
  selectedNames: string[] | undefined
): FilterCouncilMembersResult {
  if (!selectedNames || selectedNames.length === 0) {
    return {
      members: [],
      error: buildSingleMemberSelectionError(members),
    }
  }

  const memberLookup = new Map<string, CouncilMemberConfig>()
  members.forEach((member) => {
    memberLookup.set(member.model.toLowerCase(), member)
    if (member.name) {
      memberLookup.set(member.name.toLowerCase(), member)
    }
  })

  const unresolved: string[] = []
  const filteredMembers: CouncilMemberConfig[] = []
  const includedMembers = new Set<CouncilMemberConfig>()

  selectedNames.forEach((selectedName) => {
    const selectedKey = selectedName.toLowerCase()
    const matchedMember = memberLookup.get(selectedKey)
    if (!matchedMember) {
      unresolved.push(selectedName)
      return
    }

    if (includedMembers.has(matchedMember)) {
      return
    }

    includedMembers.add(matchedMember)
    filteredMembers.push(matchedMember)
  })

  if (unresolved.length > 0) {
    const availableDescriptions = members
      .map((member) => {
        if (member.name) {
          return `${member.name} (${member.model})`
        }
        return member.model
      })
      .join(", ")
    return {
      members: [],
      error: `Unknown council members: ${unresolved.join(", ")}. Available: ${availableDescriptions}.`,
    }
  }

  return { members: filteredMembers }
}

function buildToolDescription(councilConfig: CouncilConfig | undefined): string {
  const memberList = councilConfig?.members.length
    ? councilConfig.members.map((m) => `- ${m.name ?? m.model}`).join("\n")
    : "No members configured."

  return ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE.replace("{members}", `Available council members:\n${memberList}`)
}

function formatCouncilLaunchFailure(
  failures: Array<{ member: { name?: string; model: string }; error: string }>
): string {
  const failureLines = failures
    .map((failure) => `- **${failure.member.name ?? failure.member.model}**: ${failure.error}`)
    .join("\n")

  return failureLines
    ? `Failed to launch council member.\n\n### Launch Failures\n\n${failureLines}`
    : "Failed to launch council member."
}

export { isCouncilConfigured, filterCouncilMembers, buildSingleMemberSelectionError, buildToolDescription, formatCouncilLaunchFailure }
