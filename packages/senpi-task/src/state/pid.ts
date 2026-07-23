export function isProcessPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0
}
