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
  frontendA11ySkill,
  frontendBuildToolingSkill,
  frontendPerfSkill,
  frontendStateDataSkill,
  frontendTestingSkill,
  frontendUiUxSkill,
  gitMasterSkill,
  matrixxSelfConfigSkill,
  playwrightCliSkill,
  playwrightSkill,
  qualityGateSkill,
  reactNextjsPatternsSkill,
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
  svelteSveltekitPatternsSkill,
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

  const skills = [browserSkill, frontendUiUxSkill, gitMasterSkill, devBrowserSkill, dslCoreSkill, dslGrammarSkill, dslCodegenSkill, dslMetamodelSkill, dslToolingSkill, dslTextxEcosystemSkill, dslPyecoreAdvancedSkill, dslModelTransformationSkill, dslTestingSkill, dslValidationSkill, dslCompositionSkill, frontendA11ySkill, frontendBuildToolingSkill, frontendPerfSkill, frontendStateDataSkill, frontendTestingSkill, reactNextjsPatternsSkill, svelteSveltekitPatternsSkill, documentReaderSkill, securityCoreSkill, securitySecretsSkill, securitySastSkill, securityDastSkill, securityDependenciesSkill, securityApiSkill, securityCryptoSkill, securityInfraSkill, securityReviewSkill, tddEnforcerSkill, reviewWorkSkill, qualityGateSkill, softwareDevSkill, matrixxSelfConfigSkill]

  if (!disabledSkills) {
    return skills
  }

  return skills.filter((skill) => !disabledSkills.has(skill.name))
}
