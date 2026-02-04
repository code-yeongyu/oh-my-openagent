import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const backendPatternGoSkill: BuiltinSkill = {
  name: "backend-pattern-go",
  description: "Go backend development patterns and best practices",
  template: readBuiltinSkillTemplate("backend-pattern-go"),
}

export const backendPatternJavaSkill: BuiltinSkill = {
  name: "backend-pattern-java",
  description: "Java/Spring backend patterns",
  template: readBuiltinSkillTemplate("backend-pattern-java"),
}

export const backendPatternPythonSkill: BuiltinSkill = {
  name: "backend-pattern-python",
  description: "Python backend patterns (FastAPI, Django)",
  template: readBuiltinSkillTemplate("backend-pattern-python"),
}
