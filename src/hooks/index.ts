export { createTodoContinuationEnforcer, type TodoContinuationEnforcer } from "./todo-continuation-enforcer";
export { createContextWindowMonitorHook } from "./context-window-monitor";
export { createSessionNotification } from "./session-notification";
export { createSessionRecoveryHook, type SessionRecoveryHook } from "./session-recovery";
export { createCommentCheckerHooks } from "./comment-checker";
export { createGrepOutputTruncatorHook } from "./grep-output-truncator";
export { createToolOutputTruncatorHook } from "./tool-output-truncator";
export { createDirectoryAgentsInjectorHook } from "./directory-agents-injector";
export { createDirectoryReadmeInjectorHook } from "./directory-readme-injector";
export { createEmptyTaskResponseDetectorHook } from "./empty-task-response-detector";
export { createAnthropicAutoCompactHook } from "./anthropic-auto-compact";
export { createThinkModeHook } from "./think-mode";
export { createClaudeCodeHooksHook } from "./claude-code-hooks";
export { createRulesInjectorHook } from "./rules-injector";
export { createBackgroundNotificationHook } from "./background-notification"
export { createAutoUpdateCheckerHook } from "./auto-update-checker";

export { createAgentUsageReminderHook } from "./agent-usage-reminder";
export { createKeywordDetectorHook } from "./keyword-detector";
export { createNonInteractiveEnvHook } from "./non-interactive-env";
export { createInteractiveBashSessionHook } from "./interactive-bash-session";

// Governance hooks
export { createGovernancePathValidatorHook } from "./governance-path-validator";
export { createGovernanceHistorianHook } from "./governance-historian";
export { createGovernanceLinearInjectorHook } from "./governance-linear-injector";
export { createGovernanceDocsDelegationHook } from "./governance-docs-delegation";
export type { DocsDelegationConfig } from "./governance-docs-delegation";

// Hook Health Manager
export { HookHealthManager } from "./hook-health-manager";
export type {
  HookHealthState,
  HookHealthConfig,
  HookHealthSummary,
  HookExecutionResult,
} from "./hook-health-manager";

// Safety hooks (LIF-63)
export { createGitSafetyValidatorHook } from "./git-safety-validator";
export type { GitSafetyConfig, GitSafetyResult } from "./git-safety-validator";

export { createSecurityScannerHook } from "./security-scanner";
export type { SecurityScannerConfig, SecretMatch, ScanResult } from "./security-scanner";

// Conflict detection (LIF-63)
export { createConflictDetectorHook } from "./conflict-detector";
export type { ConflictDetectorConfig, FileEditLock } from "./conflict-detector";

// Workflow state enforcement (LIF-72)
export { createWorkflowStateEnforcerHook } from "./workflow-state-enforcer";
export type { WorkflowStateEnforcerConfig, WorkflowValidationResult } from "./workflow-state-enforcer";

// Meta-learning extraction (LIF-73)
export { createMetaLearningExtractorHook } from "./meta-learning-extractor";
export type { MetaLearningExtractorConfig } from "./meta-learning-extractor";

// Read-before-write enforcement (LIF-103)
export { createReadBeforeWriteHook } from "./read-before-write";
export type { ReadBeforeWriteConfig } from "./read-before-write";

// Upstream hooks (LIF-111 Phase 4)
export { createEmptyMessageSanitizerHook } from "./empty-message-sanitizer";
export { createThinkingBlockValidatorHook } from "./thinking-block-validator";
export { createCompactionContextInjector } from "./compaction-context-injector";
export {
  createPreemptiveCompactionHook,
  type SummarizeContext,
  type BeforeSummarizeCallback,
  type GetModelLimitCallback,
  type PreemptiveCompactionOptions,
  type PreemptiveCompactionState,
  type TokenInfo,
  type ModelLimits,
} from "./preemptive-compaction";
export { createEditErrorRecoveryHook, EDIT_ERROR_PATTERNS, EDIT_ERROR_REMINDER } from "./edit-error-recovery";
