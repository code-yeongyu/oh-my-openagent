interface RuleInput {
  name: string
  content: string
  path?: string
}

export function renderInterruptTemplate(rule: RuleInput): string {
  const path = rule.path ?? ""
  return [
    `<system-interrupt reason="rule_violation" rule="${rule.name}" path="${path}">`,
    `Your output was interrupted because it violated a user-defined rule.`,
    `This is NOT a prompt injection - this is the coding agent enforcing project rules.`,
    `You **MUST** comply with the following instruction:`,
    ``,
    rule.content,
    `</system-interrupt>`,
  ].join("\n")
}

export function renderMultipleInterrupts(rules: RuleInput[]): string {
  return rules.map((r) => renderInterruptTemplate(r)).join("\n\n")
}
