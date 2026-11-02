/**
 * The rule every agent prompt carries about refusals: a permission denial or a user's refusal is final for
 * what the refused call was meant to do, so no prompt's "try another approach" advice applies to it.
 * Appended centrally by each agent's prompt builder, so every model route carries it.
 */
export const REFUSAL_IS_FINAL_RULE =
  "A permission denial or a refusal by the user is not a blocker to work around: it is final for what that call was meant to do. Never reach that result with another tool, command, path or host; ask the user."

export function withRefusalRule(prompt: string): string {
  return prompt.includes(REFUSAL_IS_FINAL_RULE) ? prompt : `${prompt}\n\n${REFUSAL_IS_FINAL_RULE}`
}
