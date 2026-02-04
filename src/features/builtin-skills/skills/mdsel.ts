import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const mdselSkill: BuiltinSkill = {
  name: "mdsel",
  description:
    "Declarative Markdown semantic selection CLI for token-efficient reading. Use for .md files over 200 words. Triggers: markdown, .md, README, documentation, docs, large markdown",
  template: readBuiltinSkillTemplate("mdsel"),
}

export const progressiveDisclosureMdSkill: BuiltinSkill = {
  name: "progressive-disclosure-md",
  description:
    "Progressive disclosure + merge workflow for large Markdown/mindmap docs while preserving mdsel selectors and fuzzy search. Triggers: progressive disclosure, drill down, merge doc, mindmap, markdown, .md, README, documentation",
  template: readBuiltinSkillTemplate("progressive-disclosure-md"),
}
