import type { SkillScope } from "../../features/opencode-skill-loader/types"

export type SkillManageInput =
  | { op: "create"; name: string; content: string; scope?: "project" | "user" }
  | { op: "edit"; name: string; content: string; scope?: "project" | "user" }
  | { op: "delete"; name: string; scope?: "project" | "user" }
  | { op: "list" }
  | { op: "read"; name: string }

export type SkillManageResult =
  | { op: "create" | "edit" | "delete"; name: string; scope: "project" | "user"; path: string; warnings: string[] }
  | { op: "list"; skills: Array<{ name: string; scope: SkillScope; path?: string; description: string }> }
  | { op: "read"; name: string; scope: SkillScope; path?: string; content: string }
