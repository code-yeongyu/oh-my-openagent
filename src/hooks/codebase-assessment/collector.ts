import { existsSync } from "node:fs"
import { join } from "node:path"
import type { AssessmentResult, CodebaseState } from "./constants"
import { CONFIG_FILES, CODEBASE_STATES } from "./constants"

/**
 * Collects project configuration information by checking for config files.
 */
export function collectProjectConfig(directory: string): AssessmentResult {
  const foundConfigs: string[] = []
  
  for (const configFile of CONFIG_FILES) {
    const filePath = join(directory, configFile)
    if (existsSync(filePath)) {
      foundConfigs.push(configFile)
    }
  }

  // Determine characteristics
  const hasLinter = foundConfigs.some(f => 
    f.includes("eslint") || f.includes("biome")
  )
  const hasFormatter = foundConfigs.some(f => 
    f.includes("prettier") || f.includes("biome")
  )
  const hasTypeScript = foundConfigs.some(f => 
    f === "tsconfig.json"
  )
  const hasTests = foundConfigs.some(f => 
    f.includes("jest") || f.includes("vitest")
  )
  
  // Determine package manager
  let packageManager: AssessmentResult["packageManager"] = "unknown"
  if (foundConfigs.includes("bun.lockb")) {
    packageManager = "bun"
  } else if (foundConfigs.includes("pnpm-lock.yaml")) {
    packageManager = "pnpm"
  } else if (foundConfigs.includes("yarn.lock")) {
    packageManager = "yarn"
  } else if (foundConfigs.includes("package-lock.json")) {
    packageManager = "npm"
  }

  // Determine codebase state
  const state = determineCodebaseState({
    hasLinter,
    hasFormatter,
    hasTypeScript,
    hasTests,
    configCount: foundConfigs.length,
  })

  // Generate recommendation
  const recommendation = generateRecommendation(state)

  return {
    state,
    hasLinter,
    hasFormatter,
    hasTypeScript,
    hasTests,
    packageManager,
    configFilesFound: foundConfigs,
    recommendation,
  }
}

function determineCodebaseState(info: {
  hasLinter: boolean
  hasFormatter: boolean
  hasTypeScript: boolean
  hasTests: boolean
  configCount: number
}): CodebaseState {
  const { hasLinter, hasFormatter, hasTypeScript, hasTests, configCount } = info

  // Greenfield: Almost no configs
  if (configCount <= 2) {
    return CODEBASE_STATES.GREENFIELD
  }

  // Disciplined: Has all major tooling
  if (hasLinter && hasFormatter && hasTypeScript && hasTests) {
    return CODEBASE_STATES.DISCIPLINED
  }

  // Transitional: Has some but not all
  if ((hasLinter || hasFormatter) && (hasTypeScript || hasTests)) {
    return CODEBASE_STATES.TRANSITIONAL
  }

  // Legacy: Has configs but missing modern tooling
  return CODEBASE_STATES.LEGACY
}

function generateRecommendation(state: CodebaseState): string {
  switch (state) {
    case CODEBASE_STATES.DISCIPLINED:
      return "Follow existing patterns strictly. This codebase has established conventions."
    case CODEBASE_STATES.TRANSITIONAL:
      return "Mixed patterns detected. Ask which conventions to follow when uncertain."
    case CODEBASE_STATES.LEGACY:
      return "Limited tooling detected. Propose modern best practices but confirm with user."
    case CODEBASE_STATES.GREENFIELD:
      return "New project. Apply modern best practices (TypeScript, ESLint, testing)."
    default:
      return "Assess the codebase before making changes."
  }
}
