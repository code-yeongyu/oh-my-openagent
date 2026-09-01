export function ignoreToastError(error: unknown): void {
  if (!(error instanceof Error)) {
    return
  }
}
