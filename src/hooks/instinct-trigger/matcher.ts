export interface Instinct {
  name: string
  trigger: string
  confidence: number
  domain: string
  action?: string
}

export function matchesTrigger(instinct: Instinct, input: string): boolean {
  if (!instinct.trigger) return false
  
  const triggerLower = instinct.trigger.toLowerCase()
  const inputLower = input.toLowerCase()
  
  return inputLower.includes(triggerLower)
}

export function filterByConfidence(instincts: Instinct[], threshold = 0.7): Instinct[] {
  return instincts.filter(i => i.confidence >= threshold)
}

export function extractActionSection(markdown: string): string | undefined {
  // Match "## Action" followed by content until next heading, delimiter, or end of string
  const actionMatch = markdown.match(/^## Action\s*\n([\s\S]*?)(?=\n##|\n---|$)/m)
  return actionMatch ? actionMatch[1].trim() : undefined
}
