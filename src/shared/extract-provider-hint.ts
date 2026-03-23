export function extractProviderHint(
  modelString: string,
  connectedProviders: readonly string[] | null | undefined,
): string[] | undefined {
  if (!connectedProviders || connectedProviders.length === 0) {
    return undefined
  }

  const trimmed = modelString.trim()
  if (!trimmed) {
    return undefined
  }

  const parts = trimmed.split("/")
  if (parts.length < 2) {
    return undefined
  }

  const provider = parts[0]?.trim()
  if (!provider) {
    return undefined
  }

  return connectedProviders.includes(provider) ? [provider] : undefined
}
