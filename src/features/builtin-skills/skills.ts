import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../config/schema"
import { parseSkillTemplate, type ParsedSkillTemplate } from "./skill-parser"

import {
  playwrightSkill,
  agentBrowserSkill,
  frontendUiUxSkill,
  gitMasterSkill,
  devBrowserSkill,
} from "./skills/index"
import {
  brainstormingSkill,
  creatingChangesSkill,
  verificationBeforeCompletionSkill,
  usingGitWorktreesSkill,
  dispatchingParallelAgentsSkill,
  subagentDrivenDevelopmentSkill,
  waveParallelExecutionSkill,
  executingPlansSkill,
  finishingADevelopmentBranchSkill,
  archivingChangesSkill,
} from "./skills/workflow"
import { tddSkill, testDrivenDevelopmentSkill, systematicDebuggingSkill } from "./skills/tdd-and-debugging"
import { requestingCodeReviewSkill, receivingCodeReviewSkill } from "./skills/code-review"
import { collaboratingWithCodexSkill, collaboratingWithGeminiSkill } from "./skills/collaboration"
import { writingSkillsSkill, continuousLearningSkill } from "./skills/meta"
import { mdselSkill, progressiveDisclosureMdSkill } from "./skills/mdsel"
import { securityAuditSkill, databaseOptimizationSkill } from "./skills/security-and-database"
import { backendPatternGoSkill, backendPatternJavaSkill, backendPatternPythonSkill } from "./skills/backend-patterns"

const builtinSkillRoot = dirname(fileURLToPath(import.meta.url))
const sourceSkillRoot = join(builtinSkillRoot, "..", "..", "..", "src", "features", "builtin-skills")
const builtinSkillParsedCache = new Map<string, ParsedSkillTemplate>()

function readBuiltinSkillParsed(skillDir: string): ParsedSkillTemplate {
  const cached = builtinSkillParsedCache.get(skillDir)
  if (cached) return cached

  const candidatePaths = [
    join(builtinSkillRoot, skillDir, "SKILL.md"),
    join(sourceSkillRoot, skillDir, "SKILL.md"),
  ]

  for (const skillPath of candidatePaths) {
    if (!existsSync(skillPath)) continue
    const content = readFileSync(skillPath, "utf-8")
    const parsed = parseSkillTemplate(content)
    builtinSkillParsedCache.set(skillDir, parsed)
    return parsed
  }

  const fallback: ParsedSkillTemplate = {
    template: "",
    hooks: [],
    triggers: [],
    priority: "medium",
    hasFrontmatter: false,
  }
  builtinSkillParsedCache.set(skillDir, fallback)
  return fallback
}

function applyBuiltinSkillFrontmatter(skill: BuiltinSkill): BuiltinSkill {
  const parsed = readBuiltinSkillParsed(skill.name)
  if (!parsed.hasFrontmatter) return skill

  const metadata = {
    ...(skill.metadata ?? {}),
    skillFrontmatter: {
      hooks: parsed.hooks,
      triggers: parsed.triggers,
      priority: parsed.priority,
    },
  }

  return {
    ...skill,
    template: parsed.template || skill.template,
    description: parsed.description || skill.description,
    metadata,
  }
}

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills } = options

  const browserSkill = browserProvider === "agent-browser" ? agentBrowserSkill : playwrightSkill

  const skills = [
    browserSkill,
    brainstormingSkill,
    creatingChangesSkill,
    verificationBeforeCompletionSkill,
    usingGitWorktreesSkill,
    dispatchingParallelAgentsSkill,
    subagentDrivenDevelopmentSkill,
    tddSkill,
    testDrivenDevelopmentSkill,
    systematicDebuggingSkill,
    requestingCodeReviewSkill,
    receivingCodeReviewSkill,
    collaboratingWithCodexSkill,
    collaboratingWithGeminiSkill,
    finishingADevelopmentBranchSkill,
    archivingChangesSkill,
    writingSkillsSkill,
    frontendUiUxSkill,
    gitMasterSkill,
    waveParallelExecutionSkill,
    executingPlansSkill,
    mdselSkill,
    progressiveDisclosureMdSkill,
    devBrowserSkill,
    continuousLearningSkill,
    securityAuditSkill,
    databaseOptimizationSkill,
    backendPatternGoSkill,
    backendPatternJavaSkill,
    backendPatternPythonSkill,
  ]

  const filteredSkills = disabledSkills
    ? skills.filter((skill) => !disabledSkills.has(skill.name))
    : skills

  return filteredSkills.map(applyBuiltinSkillFrontmatter)
}
