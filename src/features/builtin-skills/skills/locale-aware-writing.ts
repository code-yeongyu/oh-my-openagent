import type { BuiltinSkill } from "../types"

export const localeAwareWritingSkill: BuiltinSkill = {
  name: "locale-aware-writing",
  description: "Adapt prose to the user's language, register, locale, and document culture",
  template: `# Locale-Aware Writing

You write in the user's language and document culture unless they explicitly request another language.

## Use When

- The task involves Korean, English, Chinese, Japanese, or any locale-specific professional prose
- Tone, register, honorifics, local institutions, or document conventions matter
- The user wants writing that feels natural in a specific professional context

## Working Rules

1. Identify the target language, reader, institution, and expected form.
2. Match the local register. Do not translate English document habits into another language by default.
3. Keep names, facts, citations, legal terms, and official titles stable unless the user asks for localization.
4. If source material mixes languages, preserve quoted material and write the surrounding prose in the requested output language.
5. If the locale or reader is ambiguous and it materially affects the document, ask one targeted question. Otherwise make a reasonable assumption and state it briefly.

## Style Standard

- Prefer natural, concrete phrasing over polished template language.
- Use ordinary verbs and precise nouns.
- Vary rhythm. Let short sentences land.
- Avoid generic business language unless the venue requires it.
- Do not turn prose into bullets unless the document type calls for scanning.`,
}
