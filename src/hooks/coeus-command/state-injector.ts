export type CoeusSessionState = "fresh" | "brief-exists" | "plan-exists"

const FRESH_CONTEXT = `## Coeus Planning — Interview Phase

No brief found. Conduct a structured interview (3-7 questions) to understand:
- Scope, constraints, success criteria
- Existing code patterns, dependencies
- Non-functional requirements

Write brief to .sisyphus/briefs/{slug}-{YYYYMMDD}.md when interview is complete.`

function briefExistsContext(briefPath: string): string {
  return `## Coeus Planning — Brief Found

Brief found at ${briefPath}. Read it and proceed to Phase 0 (knowledge verification). Skip interview.`
}

const PLAN_EXISTS_CONTEXT = `## Coeus Planning — Plan Already Exists

Plan already exists. Use /start-work to execute it.`

export function buildCoeusContext(state: CoeusSessionState, briefPath?: string): string {
  switch (state) {
    case "fresh":
      return FRESH_CONTEXT
    case "brief-exists":
      return briefExistsContext(briefPath ?? "unknown")
    case "plan-exists":
      return PLAN_EXISTS_CONTEXT
  }
}
