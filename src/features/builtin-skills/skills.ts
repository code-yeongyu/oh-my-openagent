import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../config/schema"

import {
  playwrightSkill,
  agentBrowserSkill,
  playwrightCliSkill,
  frontendUiUxSkill,
  gitMasterSkill,
  devBrowserSkill,
  dslCoreSkill,
  dslGrammarSkill,
  dslCodegenSkill,
  dslMetamodelSkill,
  dslToolingSkill,
  euHorizonSkill,
  academicReviewSkill,
  deliverableWritingSkill,
  projectManagementSkill,
  technicalLeadSkill,
  academicWritingSkill,
  researchMethodologySkill,
  literatureReviewSkill,
  grantWritingSkill,
  scientificPresentationSkill,
  dataManagementPlanSkill,
  ipExploitationSkill,
  dslTextxEcosystemSkill,
  dslPyecoreAdvancedSkill,
  dslModelTransformationSkill,
  dslTestingSkill,
  dslValidationSkill,
  dslCompositionSkill,
  documentReaderSkill,
  cryptoMarketAnalysisSkill,
  cryptoTradingSkill,
  cryptoOnchainSkill,
  securityCoreSkill,
  securitySecretsSkill,
  securitySastSkill,
  securityDastSkill,
  securityDependenciesSkill,
  securityApiSkill,
  securityCryptoSkill,
  securityInfraSkill,
  securityReviewSkill,
  tddEnforcerSkill,
  reviewWorkSkill,
} from "./skills/index"

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

  const skills = [browserSkill, frontendUiUxSkill, gitMasterSkill, devBrowserSkill, dslCoreSkill, dslGrammarSkill, dslCodegenSkill, dslMetamodelSkill, dslToolingSkill, dslTextxEcosystemSkill, dslPyecoreAdvancedSkill, dslModelTransformationSkill, dslTestingSkill, dslValidationSkill, dslCompositionSkill, euHorizonSkill, academicReviewSkill, deliverableWritingSkill, projectManagementSkill, technicalLeadSkill, academicWritingSkill, researchMethodologySkill, literatureReviewSkill, grantWritingSkill, scientificPresentationSkill, dataManagementPlanSkill, ipExploitationSkill, documentReaderSkill, cryptoMarketAnalysisSkill, cryptoTradingSkill, cryptoOnchainSkill, securityCoreSkill, securitySecretsSkill, securitySastSkill, securityDastSkill, securityDependenciesSkill, securityApiSkill, securityCryptoSkill, securityInfraSkill, securityReviewSkill, tddEnforcerSkill, reviewWorkSkill]

  if (!disabledSkills) {
    return skills
  }

  return skills.filter((skill) => !disabledSkills.has(skill.name))
}
