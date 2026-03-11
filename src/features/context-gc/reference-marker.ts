const MARKER_REGEX = /\[brain#(\d+):\s*([^\]]+)\]/g

export function createMarker(brainId: number, description: string): string {
  return `[brain#${brainId}: ${description}]`
}

export function parseMarkers(text: string): Array<{ brainId: number; description: string }> {
  const markers: Array<{ brainId: number; description: string }> = []
  const matches = text.matchAll(MARKER_REGEX)

  for (const match of matches) {
    const brainId = Number.parseInt(match[1], 10)
    if (Number.isNaN(brainId)) {
      continue
    }
    markers.push({
      brainId,
      description: match[2].trim(),
    })
  }

  return markers
}

export function hasMarkers(text: string): boolean {
  return /\[brain#\d+:/.test(text)
}
