import type { BrowserAutomationProvider } from "../../config/schema"
import {
  agentBrowserSkill,
  devBrowserSkill,
  documentReaderSkill,
  dslCodegenSkill,
  dslCompositionSkill,
  dslCoreSkill,
  dslGrammarSkill,
  dslMetamodelSkill,
  dslModelTransformationSkill,
  dslPyecoreAdvancedSkill,
  dslTestingSkill,
  dslTextxEcosystemSkill,
  dslToolingSkill,
  dslValidationSkill,
  frontendUiUxSkill,
  gitMasterSkill,
  matrixxSelfConfigSkill,
  playwrightCliSkill,
  playwrightSkill,
  qualityGateSkill,
  reviewWorkSkill,
  securityApiSkill,
  securityCoreSkill,
  securityCryptoSkill,
  securityDastSkill,
  securityDependenciesSkill,
  securityInfraSkill,
  securityReviewSkill,
  securitySastSkill,
  securitySecretsSkill,
  softwareDevSkill,
  tddEnforcerSkill,
} from "./skills/index"
import type { BuiltinSkill } from "./types"

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills } = options

  let browserSkill: BuiltinSkill
  if (browserProvider === "agent-browser") {
    browserSkill = agentBrowserSkill
  } else if (browserProvider === "playwright-cli") {
    browserSkill = playwrightCliSkill
  } else {
    browserSkill = playwrightSkill
  }

  const skills = [browserSkill, frontendUiUxSkill, gitMasterSkill, devBrowserSkill, dslCoreSkill, dslGrammarSkill, dslCodegenSkill, dslMetamodelSkill, dslToolingSkill, dslTextxEcosystemSkill, dslPyecoreAdvancedSkill, dslModelTransformationSkill, dslTestingSkill, dslValidationSkill, dslCompositionSkill, documentReaderSkill, securityCoreSkill, securitySecretsSkill, securitySastSkill, securityDastSkill, securityDependenciesSkill, securityApiSkill, securityCryptoSkill, securityInfraSkill, securityReviewSkill, tddEnforcerSkill, reviewWorkSkill, qualityGateSkill, softwareDevSkill, matrixxSelfConfigSkill]

  if (!disabledSkills) {
    return skills
  }

  return skills.filter((skill) => !disabledSkills.has(skill.name))
}
