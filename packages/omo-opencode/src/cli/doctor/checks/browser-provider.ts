import { BrowserAutomationConfigSchema } from "../../../config/schema/browser-automation"
import { loadOmoOpenCodeConfigChain } from "../../../plugin-config/omo-config-chain"
import type { CheckResult, DoctorIssue } from "../framework/types"

export async function checkBrowserProvider(): Promise<CheckResult> {
  const chain = loadOmoOpenCodeConfigChain(process.cwd())
  const issues: DoctorIssue[] = []

  for (const view of chain.views) {
    const browserConfig = view.config.browser_automation_engine
    if (browserConfig === undefined) continue
    const result = BrowserAutomationConfigSchema.safeParse(browserConfig)
    if (result.success) continue
    for (const issue of result.error.issues) {
      const path = ["browser_automation_engine", ...issue.path].join(".")
      issues.push({
        title: "Invalid browser provider configuration",
        description: `${view.path}: ${path}: ${issue.message}`,
        severity: "error",
        affects: [path],
      })
    }
  }

  return {
    name: "Browser Provider",
    status: issues.length > 0 ? "fail" : "pass",
    message: issues.length > 0 ? "Browser provider configuration requires migration" : "Browser provider configuration is valid",
    issues,
  }
}
