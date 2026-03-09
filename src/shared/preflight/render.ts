import color from "picocolors"
import type { SanityCheckResult } from "./types"

export function displaySanityCheck(result: SanityCheckResult): void {
  if (result.issues.length === 0) {
    return
  }

  console.log()
  console.log(color.yellow("Sanity check"))

  for (const issue of result.issues) {
    const icon = issue.level === "error" ? color.red("✗") : color.yellow("!")
    console.log(`  ${icon} ${color.dim(issue.path)}: ${issue.message}`)
  }

  console.log()
}
