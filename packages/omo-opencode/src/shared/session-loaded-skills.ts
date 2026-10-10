export type LoadedSkillRecord = {
  name: string
  body: string
}

const loadedSkillsBySession = new Map<string, Map<string, LoadedSkillRecord>>()

export function recordLoadedSkill(
  sessionID: string,
  name: string,
  body: string,
): void {
  if (!sessionID) {
    return
  }

  let skills = loadedSkillsBySession.get(sessionID)
  if (!skills) {
    skills = new Map()
    loadedSkillsBySession.set(sessionID, skills)
  }
  skills.set(name, { name, body })
}

export function getSessionLoadedSkills(sessionID: string): LoadedSkillRecord[] {
  const skills = loadedSkillsBySession.get(sessionID)
  return skills ? Array.from(skills.values()) : []
}

export function clearSessionLoadedSkills(sessionID: string): void {
  loadedSkillsBySession.delete(sessionID)
}

export function _resetLoadedSkillsForTesting(): void {
  loadedSkillsBySession.clear()
}
