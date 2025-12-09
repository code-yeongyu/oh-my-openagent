export type SkillScope = "user" | "project"

export interface SkillMetadata {
  name: string
  description: string
  license?: string
}

export interface SkillInfo {
  name: string
  path: string
  metadata: SkillMetadata
  content: string
  references: string[]
  scripts: string[]
  assets: string[]
}

export interface LoadedSkill {
  name: string
  metadata: SkillMetadata
  body: string
  referencesLoaded: Array<{ path: string; content: string }>
}
