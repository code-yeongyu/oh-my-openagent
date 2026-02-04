import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const collaboratingWithCodexSkill: BuiltinSkill = {
  name: "collaborating-with-codex",
  description: "Delegates coding tasks to Codex CLI for prototyping, debugging, and code review. Use when needing algorithm implementation, bug analysis, or code quality feedback. Supports multi-turn sessions via SESSION_ID.",
  template: readBuiltinSkillTemplate("collaborating-with-codex"),
}

export const collaboratingWithGeminiSkill: BuiltinSkill = {
  name: "collaborating-with-gemini",
  description: "Delegates coding tasks to Gemini CLI for prototyping, debugging, and code review. Use when needing algorithm implementation, bug analysis, or code quality feedback. Supports multi-turn sessions via SESSION_ID.",
  template: readBuiltinSkillTemplate("collaborating-with-gemini"),
}
