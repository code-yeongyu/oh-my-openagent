export function scheduleDeferredStartupCheck(runCheck: () => void): void {
  const timeout = setTimeout(runCheck, 5000)
  timeout.unref?.()
}
