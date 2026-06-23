const DEFAULT_TEMPLATE = "The quick brown fox jumps over the lazy dog. "

export function buildSizedPrompt(targetChars: number, template?: string): string {
  if (targetChars <= 0) return ""
  const tpl = template && template.length > 0 ? template : DEFAULT_TEMPLATE
  if (tpl.length >= targetChars) return tpl.slice(0, targetChars)
  const repeats = Math.ceil(targetChars / tpl.length)
  return tpl.repeat(repeats).slice(0, targetChars)
}
