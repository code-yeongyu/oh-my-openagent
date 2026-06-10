export type DoctorTarget = "opencode" | "codex"

export function resolveDoctorTarget(invocationName: string | undefined): DoctorTarget {
  return invocationName === "lazycodex" || invocationName === "lazycodex-ai" ? "codex" : "opencode"
}
