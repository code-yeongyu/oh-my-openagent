type TimerHandleWithOptionalUnref = ReturnType<typeof setTimeout> & {
  readonly unref?: () => unknown
}

export function unrefTimerHandle(handle: TimerHandleWithOptionalUnref): void {
  const maybeUnref = handle.unref
  if (typeof maybeUnref !== "function") {
    return
  }

  try {
    maybeUnref.call(handle)
  } catch (error) {
    if (error instanceof Error) {
      return
    }
    return
  }
}
