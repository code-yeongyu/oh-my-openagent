export async function abortBtwSide(args: {
  sessionID: string
  abortSession: (sessionID: string) => Promise<void>
  showToast: (message: string) => void
}): Promise<void> {
  try {
    await args.abortSession(args.sessionID)
  } catch {
    args.showToast("BTW could not stop the active side turn.")
  }
}

export async function deleteBtwSide(args: {
  sessionID: string
  deleteSession: (sessionID: string) => Promise<void>
  showToast: (message: string) => void
  failureMessage: string
}): Promise<boolean> {
  try {
    await args.deleteSession(args.sessionID)
    return true
  } catch {
    args.showToast(args.failureMessage)
    return false
  }
}

