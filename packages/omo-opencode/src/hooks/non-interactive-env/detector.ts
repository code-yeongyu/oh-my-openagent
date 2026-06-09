export function isNonInteractive(): boolean {
  if (process.env.CI === "true" || process.env.CI === "1") {
    return true
  }

  if (process.env.OPENCODE_RUN === "true" || process.env.OPENCODE_NON_INTERACTIVE === "true") {
    return true
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    return true
  }

  if (process.stdout.isTTY !== true) {
    return true
  }

  return false
}
