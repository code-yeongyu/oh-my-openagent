export function getResourceIndicator(url: string): string {
  const parsed = new URL(url)
  parsed.search = ""
  parsed.hash = ""

  let normalized = parsed.toString()
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

export function addResourceToParams(params: URLSearchParams, resource: string): void {
  params.set("resource", resource)
}
