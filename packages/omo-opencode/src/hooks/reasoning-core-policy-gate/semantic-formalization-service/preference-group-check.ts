import type { Theory } from "./types"

export type PreferenceGroupViolation =
  | { violation: "invalid_preference_group_size"; group_id: string }
  | { violation: "invalid_preference_group_references"; group_id: string; element: string }
  | {
      violation: "duplicate_preference_group_elements"
      element: string
      group_id: string
      existing_group_id: string
    }

function collectPreferenceGroups(theory: Theory) {
  if (!theory.preferences || Array.isArray(theory.preferences)) {
    return []
  }

  return theory.preferences.groups ?? []
}

export function findPreferenceGroupViolation(
  theory: Theory,
  seenRuleIds: Set<string>,
  knownFormulas: Set<string>,
): PreferenceGroupViolation | null {
  const seenGroupElements = new Map<string, string>()

  for (const group of collectPreferenceGroups(theory)) {
    if (group.ordered_rules.length < 2) {
      return { violation: "invalid_preference_group_size", group_id: group.group_id }
    }

    for (const element of group.ordered_rules) {
      if (!seenRuleIds.has(element) && !knownFormulas.has(element)) {
        return { violation: "invalid_preference_group_references", group_id: group.group_id, element }
      }

      const existingGroup = seenGroupElements.get(element)
      if (existingGroup && existingGroup !== group.group_id) {
        return {
          violation: "duplicate_preference_group_elements",
          element,
          group_id: group.group_id,
          existing_group_id: existingGroup,
        }
      }

      seenGroupElements.set(element, group.group_id)
    }
  }

  return null
}
