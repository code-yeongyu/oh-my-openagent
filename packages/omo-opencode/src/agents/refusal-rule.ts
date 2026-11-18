/**
 * The rule every agent prompt carries about refusals: a permission denial or a user's refusal is final for
 * what the refused call was meant to do, so no prompt's "try another approach" advice applies to it.
 * Each agent's prompt builder appends it to the role. A framed prompt then states it once in the frame (the model
 * core's own copy, or this one right after the core), so every model route carries it exactly once.
 */
export const REFUSAL_IS_FINAL_RULE =
  "A permission denial or a refusal by the user is not a blocker to work around: it is final for what that call was meant to do. Never reach that result with another tool, command, path or host; ask the user."

export function withRefusalRule(prompt: string): string {
  return prompt.includes(REFUSAL_IS_FINAL_RULE) ? prompt : `${prompt}\n\n${REFUSAL_IS_FINAL_RULE}`
}

/** The prompt without the copy `withRefusalRule` appended: a framed prompt states the rule in its frame instead. */
export function withoutRefusalRule(prompt: string): string {
  const appended = `\n\n${REFUSAL_IS_FINAL_RULE}`
  return prompt.endsWith(appended) ? prompt.slice(0, -appended.length) : prompt
}
