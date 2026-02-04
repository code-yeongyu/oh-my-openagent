import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const tddSkill: BuiltinSkill = {
  name: "tdd",
  description:
    "Test-Driven Development skill - RED-GREEN-REFACTOR workflow. Use when implementing features, fixing bugs, or when TDD Guard blocks your edit.",
  template: readBuiltinSkillTemplate("tdd"),
}

export const testDrivenDevelopmentSkill: BuiltinSkill = {
  name: "test-driven-development",
  description: "Use when implementing any feature or bugfix, before writing implementation code",
  template: readBuiltinSkillTemplate("test-driven-development"),
}

export const systematicDebuggingSkill: BuiltinSkill = {
  name: "systematic-debugging",
  description: "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes",
  template: readBuiltinSkillTemplate("systematic-debugging"),
}
