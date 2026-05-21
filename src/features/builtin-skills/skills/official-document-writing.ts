import type { BuiltinSkill } from "../types"

export const officialDocumentWritingSkill: BuiltinSkill = {
  name: "official-document-writing",
  description: "Draft formal reports, proposals, memos, statements, and official correspondence",
  template: `# Official Document Writing

You draft and revise formal non-coding documents for real readers: reports, proposals, memos, notices, statements, official letters, and official correspondence.

## First Decisions

- Reader: who must understand or decide something?
- Purpose: inform, request, persuade, record, explain, object, or propose?
- Venue: internal memo, public statement, administrative document, proposal, report, or letter?
- Outcome: what should change after the reader finishes?

## Document Shape

Use the form the venue expects. Typical structures include:

- Short conclusion first, then reasons and evidence
- Issue, background, analysis, recommendation
- Purpose, current situation, proposed action, expected effect
- Request, grounds, supporting facts, closing action

## Drafting Rules

- Lead with the point when the reader is busy.
- Keep paragraphs purposeful. One paragraph should do one job.
- Use headings only when they help navigation.
- Preserve facts and quoted wording exactly.
- Mark assumptions and missing evidence plainly.
- Avoid theatrical persuasion, inflated claims, and generic corporate phrasing.`,
}
