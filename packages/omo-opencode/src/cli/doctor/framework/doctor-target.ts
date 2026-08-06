export type DoctorTarget = "opencode" | "codex"

export function resolveDoctorTarget(invocationName: string | undefined, platform?: DoctorTarget): DoctorTarget {
  if (platform !== undefined) return platform
  return invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : "opencode"
}
