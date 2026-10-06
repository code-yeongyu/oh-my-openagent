/**
 * The operating-rules block a gateway session carries in its system prompt: the scope's compiled
 * behavioral rules under one version marker, wrapped in a sentinel so a later turn replaces the
 * same bytes instead of appending a second block. Mechanical gate params never render here - the
 * prompt block is behavioral text only, so nothing the mechanical enforcement layer computes
 * (identities, budgets, thresholds) can leak into a prompt.
 */

export const GATEWAY_RULES_SENTINEL_BEGIN = "<!-- omo-gateway:rules:begin -->"
export const GATEWAY_RULES_SENTINEL_END = "<!-- omo-gateway:rules:end -->"

const SENTINEL_PATTERN = /<!-- omo-gateway:rules:begin -->[\s\S]*?<!-- omo-gateway:rules:end -->/

export function escapeRuleText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function renderOperatingRulesBlock(version: string, behavioral: readonly string[]): string {
  const lines = [`<operating-rules version="${escapeRuleText(version).replaceAll('"', "&quot;")}">`]
  for (const text of behavioral) lines.push(`- ${escapeRuleText(text)}`)
  lines.push("</operating-rules>")
  return lines.join("\n")
}

export function markGatewayRulesBlock(block: string): string {
  return `${GATEWAY_RULES_SENTINEL_BEGIN}\n${block}\n${GATEWAY_RULES_SENTINEL_END}`
}

/**
 * Compose the block into a system prompt: replace the previous turn's sentinel region when the
 * host carried it back in (a preview or a reused payload), append after the existing content
 * otherwise. Given the same block, both paths produce the same bytes every turn.
 */
export function composeGatewayRulesBlock(systemPrompt: string, block: string): string {
  const marked = markGatewayRulesBlock(block)
  if (SENTINEL_PATTERN.test(systemPrompt)) return systemPrompt.replace(SENTINEL_PATTERN, () => marked)
  return `${systemPrompt.trimEnd()}\n\n${marked}`
}
