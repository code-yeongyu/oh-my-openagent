/**
 * Init-Project Tool
 * 
 * Main entry point for the init-project command utilities.
 * Exports all modules for programmatic use.
 */

// Tech Detection
export {
  detectTechStack,
  formatDetectionResults,
  type DetectedLanguage,
  type DetectedFramework,
  type DetectedDatabase,
  type TechStack,
  type ProjectInfo,
} from "./tech-detection";

// Config Generation
export {
  generateOpencodeJson,
  generateProjectContextYaml,
  generateMintJson,
  generateIntroductionMdx,
  generateArchitectureOverviewMdx,
  writeConfigFiles,
  suggestArchitecture,
  getSuggestionReason,
  PROJECT_TYPES,
  ARCHITECTURE_PATTERNS,
  type ProjectType,
  type ArchitecturePattern,
  type ArchitectureLayer,
  type LinearConfig,
  type MintlifyConfig,
  type InitProjectConfig,
} from "./config-generator";

// AGENTS.md Generation
export {
  generateAgentsMdFiles,
  generateRootAgentsMd,
  generateLayerAgentsMd,
  getLayerTemplate,
  loadTemplate,
} from "./agents-generator";

// Linear Setup
export {
  validateApiKey,
  checkLinearApiKey,
  createLinearConfig,
  generateLinearWorkflowInstructions,
  getLinearSetupStep,
  formatLinearSetupSummary,
  type LinearTeam,
  type LinearProject,
  type LinearSetupResult,
  type LinearSetupOptions,
  type LinearSetupFlow,
} from "./linear-setup";

// Edge Cases
export {
  checkExistingConfiguration,
  getConflictResolutionPrompt,
  handleExistingConfig,
  getLinearSetupInstructions,
  getCustomArchitecturePrompt,
  createCustomArchitecture,
  generateCustomLayerAgentsMd,
  detectMonorepo,
  getMonorepoConfigPrompt,
  isNetworkAvailable,
  getOfflineModePrompt,
  type ExistingConfigCheck,
  type ConflictResolution,
  type CustomLayerDefinition,
  type MonorepoInfo,
} from "./edge-cases";

// Re-export runner
export { runInitProject, generateSummary, type InitProjectOptions } from "./runner";

