export const FALLBACK_GITHUB_STARS = 2_375

export function formatStarsCount(stars: number): string {
  if (stars >= 1_000_000) {
    const formatted = (stars / 1_000_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}M`
  }

  if (stars >= 1_000) {
    const formatted = (stars / 1_000).toFixed(1)
    return `${formatted.replace(/\.0$/, "")}k`
  }

  return String(stars)
}
