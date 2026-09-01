export type DoctorTarget = "opencode" | "codex"

export function resolveDoctorTarget(invocationName: string | undefined, platform?: DoctorTarget): DoctorTarget {
  if (platform !== undefined) return platform
  if (process.env.OMO_EDITION === "codex") return "codex"
  return invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : "opencode"
}
