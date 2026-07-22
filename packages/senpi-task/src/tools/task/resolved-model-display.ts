export function qualifyResolvedModelDisplay(
  provider: string | undefined,
  display: string | undefined,
): string | undefined {
  if (display === undefined) return provider
  if (provider === undefined) return display

  const normalizedProvider = provider.toLocaleLowerCase()
  const normalizedDisplay = display.toLocaleLowerCase()
  if (!normalizedDisplay.startsWith(normalizedProvider)) return `${provider} ${display}`

  const separator = display.slice(provider.length, provider.length + 1)
  return separator.length === 0 || /[\s/,:._-]/u.test(separator) ? display : `${provider} ${display}`
}
