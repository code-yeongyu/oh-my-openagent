// Ported verbatim from the senpi task component's usage-guidance helper: the reflection worker only
// needs the once-per-session guard, so the helper is kept local to the memory component instead of
// depending on the (still-being-ported) omp task component.
export function createOncePerSessionGuard(): (sessionId: string) => boolean {
  const seen = new Set<string>()
  return (sessionId: string): boolean => {
    if (seen.has(sessionId)) return false
    seen.add(sessionId)
    return true
  }
}
