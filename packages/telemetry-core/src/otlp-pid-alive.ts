/** Signal 0 probes a pid without signalling it; EPERM means the process exists but belongs to another user. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}
