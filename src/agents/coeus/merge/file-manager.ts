import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { SubPlanSchema, type SubPlan } from "../schemas/sub-plan-schema"

const SUB_PLANS_DIR = ".sisyphus/sub-plans"

export function createSubPlanDir(projectDir: string, sessionId: string): string {
  const dir = join(projectDir, SUB_PLANS_DIR, sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeSubPlan(dir: string, domain: string, content: string): string {
  const filePath = join(dir, `${domain}.json`)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

export function readSubPlans(dir: string): SubPlan[] {
  if (!existsSync(dir)) {
    return []
  }

  const files = readdirSync(dir)
  const subPlans: SubPlan[] = []

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue
    }

    const filePath = join(dir, file)
    try {
      const content = readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(content)
      const validated = SubPlanSchema.parse(parsed)
      subPlans.push(validated)
    } catch (error) {
      console.warn(`Skipping invalid sub-plan file ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return subPlans
}

export function cleanupSubPlans(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}
