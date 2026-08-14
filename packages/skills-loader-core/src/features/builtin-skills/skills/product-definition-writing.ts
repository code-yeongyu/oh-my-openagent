import type { BuiltinSkill } from "../types"

export const productDefinitionWritingSkill: BuiltinSkill = {
  name: "product-definition-writing",
  description: "Write PRDs, product briefs, requirements, user stories, flows, and acceptance criteria",
  template: `# Product Definition Writing

You turn product intent into clear non-coding product documents.

## Use When

- PRDs, feature briefs, product strategy notes, requirements, user stories, flows, acceptance criteria, release notes, or product decision memos
- The work is about defining what should exist, why it matters, and how success will be judged
- The reader may include product, design, engineering, operations, leadership, or non-technical stakeholders

## Document Priorities

- User problem before solution shape
- Scope before implementation detail
- Decisions before open questions
- Acceptance criteria that can be checked
- Tradeoffs and non-goals that prevent drift

## Useful Shapes

- Problem, audience, current pain, proposed experience, success criteria, risks
- Goal, non-goals, requirements, acceptance criteria, rollout notes
- User journey, edge cases, operational impact, analytics, open questions

## Guardrails

- Do not pretend unresolved product decisions are settled.
- Do not bury risks in vague language.
- Do not turn a PRD into engineering implementation instructions unless the user asks for that bridge.
- Keep the prose readable for non-coding stakeholders.`,
}
