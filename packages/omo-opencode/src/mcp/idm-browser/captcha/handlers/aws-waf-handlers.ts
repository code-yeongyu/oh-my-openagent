import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"

async function extractAwsWaf(page: Page): Promise<CapsolverExtraction | null> {
  const url = page.url()
  if (!url) return null
  return { taskExtra: { awsKey: "AWS_WAF_DEFAULT", awsIv: "", awsContext: "" } }
}

async function injectAwsWaf(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  return page.evaluate((t) => {
    document.cookie = `aws-waf-token=${t}; path=/`
    return true
  }, token)
}

export const awsWafHandler: CapsolverTaskHandler = {
  taskType: "AntiAwsWafTask",
  extract: extractAwsWaf,
  inject: injectAwsWaf,
}
