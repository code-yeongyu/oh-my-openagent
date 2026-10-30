export type PidLiveness = "alive" | "dead" | "unknown"

// Signal 0 only probes existence (the single-writer audit keeps every process.kill in lifecycle/).
// EPERM means the pid exists under another user; any other failure proves nothing either way.
export function pidLiveness(pid: number): PidLiveness {
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code === "ESRCH") return "dead"
    return code === "EPERM" ? "alive" : "unknown"
  }
}
