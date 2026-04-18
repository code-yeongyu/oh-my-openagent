export function scheduleDeferredIdleCheck(runCheck: () => void): void {
  const timeout = setTimeout(runCheck, 5000)
  timeout.unref?.()
}
