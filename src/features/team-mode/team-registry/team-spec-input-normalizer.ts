import type { CallerTeamLead } from "../resolve-caller-team-lead"

type JsonRecord = Record<string, unknown>

export type NormalizeTeamSpecInputOptions = {
  callerTeamLead?: CallerTeamLead
  defaultCategoryName?: string
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneJsonRecord(value: JsonRecord): JsonRecord {
  return { ...value }
}

function getMemberName(value: unknown): string | undefined {
  return isJsonRecord(value) && typeof value.name === "string" ? value.name : undefined
}

function normalizeNameStem(value: string): string {
  const normalizedStem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalizedStem.length > 0 ? normalizedStem : "member"
}

function deriveMemberNameStem(member: JsonRecord): string {
  if (member.kind === "category" && typeof member.category === "string") {
    return normalizeNameStem(member.category)
  }

  if (member.kind === "subagent_type" && typeof member.subagent_type === "string") {
    return normalizeNameStem(member.subagent_type)
  }

  return "member"
}

function assignGeneratedMemberNames(rawMembers: unknown[]): unknown[] {
  const usedNames = new Set<string>()

  return rawMembers.map((member) => {
    if (!isJsonRecord(member)) {
      return member
    }

    const rawName = getMemberName(member)
    const stem = rawName === undefined ? deriveMemberNameStem(member) : normalizeNameStem(rawName)
    let generatedName = rawName === undefined ? `${stem}-1` : stem
    let suffix = rawName === undefined ? 1 : 2
    while (usedNames.has(generatedName)) {
      generatedName = `${stem}-${suffix}`
      suffix += 1
    }

    usedNames.add(generatedName)
    return { ...member, name: generatedName }
  })
}

function stripMemberLeadFlag(value: unknown): unknown {
  if (!isJsonRecord(value) || !Object.hasOwn(value, "isLead")) {
    return value
  }

  const { isLead: _isLead, ...memberWithoutLeadFlag } = value
  return memberWithoutLeadFlag
}

function hasMemberLeadFlag(rawMembers: unknown[]): boolean {
  return rawMembers.some((member) => isJsonRecord(member) && member.isLead === true)
}

function createCallerLeadMember(callerAgentTypeId: string): JsonRecord {
  return {
    name: "lead",
    kind: "subagent_type",
    subagent_type: callerAgentTypeId,
  }
}

function getPromptAlias(member: JsonRecord): string | undefined {
  if (typeof member.prompt === "string") {
    return member.prompt
  }

  if (typeof member.systemPrompt === "string") {
    return member.systemPrompt
  }

  if (typeof member.system_prompt === "string") {
    return member.system_prompt
  }

  return undefined
}

function formatStringArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return strings.length > 0 ? strings.join(", ") : undefined
}

function buildPromptFromNaturalMember(member: JsonRecord): string {
  const promptAlias = getPromptAlias(member)
  if (promptAlias !== undefined) {
    return promptAlias
  }

  const promptParts = [
    typeof member.role === "string" ? `Role: ${member.role}` : undefined,
    typeof member.description === "string" ? member.description : undefined,
    formatStringArray(member.capabilities),
    formatStringArray(member.responsibilities),
  ].filter((part): part is string => part !== undefined && part.trim().length > 0)

  return promptParts.length > 0
    ? promptParts.join("\n")
    : "Work on the assigned team task and report findings to the lead."
}

function normalizeInlineMember(member: JsonRecord, options?: NormalizeTeamSpecInputOptions): JsonRecord {
  const {
    capabilities: _capabilities,
    description: _description,
    loadSkills: _loadSkills,
    load_skills: _loadSkillsSnakeCase,
    responsibilities: _responsibilities,
    role: _role,
    systemPrompt: _systemPrompt,
    system_prompt: _systemPromptSnakeCase,
    ...normalizedMember
  } = member

  const rawKind = normalizedMember.kind

  if (normalizedMember.kind === undefined) {
    if (typeof normalizedMember.category === "string") {
      normalizedMember.kind = "category"
    } else if (typeof normalizedMember.subagent_type === "string") {
      normalizedMember.kind = "subagent_type"
    } else if (options?.defaultCategoryName !== undefined) {
      normalizedMember.kind = "category"
      normalizedMember.category = options.defaultCategoryName
    }
  } else if (normalizedMember.kind !== "category" && normalizedMember.kind !== "subagent_type") {
    if (typeof normalizedMember.category === "string") {
      normalizedMember.kind = "category"
    } else if (typeof normalizedMember.subagent_type === "string") {
      normalizedMember.kind = "subagent_type"
    } else if (typeof rawKind === "string" && rawKind !== "agent" && rawKind !== "member" && rawKind !== "worker" && rawKind !== "analyst") {
      normalizedMember.kind = "category"
      normalizedMember.category = rawKind
    } else if (options?.defaultCategoryName !== undefined) {
      normalizedMember.kind = "category"
      normalizedMember.category = options.defaultCategoryName
    }
  }

  if (normalizedMember.kind === "category" && normalizedMember.prompt === undefined) {
    normalizedMember.prompt = buildPromptFromNaturalMember(member)
  }

  return normalizedMember
}

export function normalizeTeamSpecInput(raw: unknown, options?: NormalizeTeamSpecInputOptions): unknown {
  if (!isJsonRecord(raw)) {
    return raw
  }

  const normalizedSpec = cloneJsonRecord(raw)
  if (typeof normalizedSpec.name === "string") {
    normalizedSpec.name = normalizeNameStem(normalizedSpec.name)
  }

  const rawMembers = raw.members
  const rawLead = raw.lead
  let leadAgentId = typeof raw.leadAgentId === "string" ? raw.leadAgentId : undefined
  const hasExplicitLead = leadAgentId !== undefined
    || isJsonRecord(rawLead)
    || (Array.isArray(rawMembers) && hasMemberLeadFlag(rawMembers))

  if (Array.isArray(rawMembers)) {
    let normalizedMembers = rawMembers.map((member) => isJsonRecord(member) ? normalizeInlineMember(member, options) : member)

    if (isJsonRecord(rawLead)) {
      const leadMember = normalizeInlineMember(rawLead, options)
      if (leadMember.name === undefined) {
        leadMember.name = "lead"
      }

      const leadName = getMemberName(leadMember)
      const alreadyPresent = leadName !== undefined && normalizedMembers.some((member) => getMemberName(member) === leadName)
      if (!alreadyPresent) {
        normalizedMembers = [leadMember, ...normalizedMembers]
      }

      if (leadAgentId === undefined && leadName !== undefined) {
        leadAgentId = leadName
      }
    }

    if (!hasExplicitLead) {
      const callerTeamLead = options?.callerTeamLead
      if (callerTeamLead?.isEligibleForTeamLead && callerTeamLead.agentTypeId !== undefined) {
        normalizedMembers = [createCallerLeadMember(callerTeamLead.agentTypeId), ...normalizedMembers]
        leadAgentId = "lead"
      } else if (callerTeamLead?.displayName !== undefined) {
        throw new Error(`Caller agent ${callerTeamLead.displayName} is not eligible as team lead; specify leadAgentId explicitly`)
      }
    }

    normalizedMembers = assignGeneratedMemberNames(normalizedMembers)

    normalizedMembers = normalizedMembers.map((member) => {
      const memberName = getMemberName(member)
      const isLead = isJsonRecord(member) && member.isLead === true
      if (leadAgentId === undefined && isLead && memberName !== undefined) {
        leadAgentId = memberName
      }
      return stripMemberLeadFlag(member)
    })

    if (leadAgentId !== undefined && !normalizedMembers.some((member) => getMemberName(member) === leadAgentId)) {
      const normalizedLeadAgentId = normalizeNameStem(leadAgentId)
      if (normalizedMembers.some((member) => getMemberName(member) === normalizedLeadAgentId)) {
        leadAgentId = normalizedLeadAgentId
      }
    }

    if (leadAgentId === undefined && normalizedMembers.length === 1) {
      leadAgentId = getMemberName(normalizedMembers[0])
    }

    normalizedSpec.members = normalizedMembers
  }

  if (leadAgentId !== undefined) {
    normalizedSpec.leadAgentId = leadAgentId
  }

  delete normalizedSpec.lead

  return normalizedSpec
}
