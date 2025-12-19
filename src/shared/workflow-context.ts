/**
 * Workflow Context - Shared context for workflow commands
 *
 * Provides unified context resolution for /specify, /plan, /tasks, /implement, /review, /test.
 * Resolves context from: CLI args → spec folder metadata → branch parsing → defaults.
 *
 * @module workflow-context
 * @see .cursor/specs/LIF-65-feat-command-workflow-harmonization/plan.md
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, basename } from "node:path"
import { createHash } from "node:crypto"

/** Linear integration policy modes */
export type LinearPolicy = "off" | "optional" | "required"

/** How the context was resolved */
export type ContextSource =
  | "cli_args" // Explicit arguments provided
  | "spec_folder" // Detected from spec folder metadata
  | "branch_parsing" // Parsed from git branch name
  | "user_prompt" // User responded to prompt
  | "default" // Fallback defaults

/** Shared context object passed between workflow commands */
export interface WorkflowContext {
  /** Spec folder path (e.g., ".cursor/specs/LIF-65-feat-...") */
  specPath: string | null
  /** Linear issue ID (e.g., "LIF-65") */
  linearIssueId: string | null
  /** Git branch name (e.g., "hello/lif-65-...") */
  branchName: string | null
  /** Linear integration policy */
  policy: LinearPolicy
  /** Unique execution ID */
  runId: string
  /** Absolute path to repo root */
  repoRoot: string
  /** How context was resolved */
  resolvedFrom: ContextSource
}

/** Persisted workflow state for session continuity */
export interface WorkflowState {
  /** Current workflow step */
  currentStep: WorkflowStep
  /** Completed workflow steps */
  completedSteps: WorkflowStep[]
  /** Artifact hashes for drift detection (filename -> sha256) */
  artifactHashes: Record<string, string>
  /** Associated Linear issue ID */
  linearIssueId: string | null
  /** Current Linear status */
  linearStatus: string | null
  /** ISO timestamp when state was created */
  createdAt: string
  /** ISO timestamp when state was last updated */
  updatedAt: string
  /** Last command that updated state */
  lastCommand: string
}

/** Workflow steps in order */
export type WorkflowStep =
  | "specify"
  | "plan"
  | "tasks"
  | "implement"
  | "review"
  | "test"
  | "complete"

/** Options for resolving workflow context */
export interface ResolveContextOptions {
  /** Explicit spec directory path */
  specDir?: string
  /** Explicit Linear issue ID */
  linearIssueId?: string
  /** Repository root path */
  repoRoot?: string
  /** Current git branch (if known) */
  branch?: string
}

/**
 * Parse Linear issue ID from branch name.
 *
 * Supports formats:
 * - "hello/lif-65-feature-name" → "LIF-65"
 * - "LIF-65-feature-name" → "LIF-65"
 * - "feature/ABC-123-something" → "ABC-123"
 *
 * @param branch Git branch name
 * @returns Linear issue ID or null
 */
export function parseIssueIdFromBranch(branch: string): string | null {
  // Pattern: {prefix}/? {team}-{number} - any suffix
  // Supports: hello/lif-65-..., LIF-65-..., feature/ABC-123-...
  const match = branch.match(/(?:^|\/)?([A-Za-z]+-\d+)/i)
  if (match) {
    return match[1].toUpperCase()
  }
  return null
}

/**
 * Find spec folder matching a Linear issue ID.
 *
 * Searches in:
 * - .cursor/specs/{ISSUE-ID}-*
 * - context/specs/{ISSUE-ID}-*
 *
 * @param issueId Linear issue ID (e.g., "LIF-65")
 * @param repoRoot Repository root path
 * @returns Spec folder path or null
 */
export function findSpecFolderByIssueId(
  issueId: string,
  repoRoot: string
): string | null {
  const specDirs = [
    join(repoRoot, ".cursor/specs"),
    join(repoRoot, "context/specs"),
  ]

  for (const specDir of specDirs) {
    if (!existsSync(specDir)) continue

    const folders = readdirSync(specDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    // Find folder starting with issue ID (case insensitive)
    const match = folders.find((f) =>
      f.toUpperCase().startsWith(issueId.toUpperCase())
    )

    if (match) {
      return join(specDir, match)
    }
  }

  return null
}

/**
 * Find spec folder matching current branch.
 *
 * Parses branch name for Linear issue ID and searches for matching spec folder.
 *
 * @param branch Git branch name
 * @param repoRoot Repository root path
 * @returns Spec folder path or null
 */
export function findSpecFolderByBranch(
  branch: string,
  repoRoot: string
): string | null {
  const issueId = parseIssueIdFromBranch(branch)
  if (!issueId) return null

  return findSpecFolderByIssueId(issueId, repoRoot)
}

/**
 * Extract Linear issue ID from spec folder path.
 *
 * Supports formats:
 * - ".cursor/specs/LIF-65-feat-feature-name" → "LIF-65"
 * - "context/specs/ABC-123-fix-bug" → "ABC-123"
 *
 * @param specPath Spec folder path
 * @returns Linear issue ID or null
 */
export function extractIssueIdFromSpecPath(specPath: string): string | null {
  const folderName = basename(specPath)
  const match = folderName.match(/^([A-Za-z]+-\d+)/i)
  if (match) {
    return match[1].toUpperCase()
  }
  return null
}

/**
 * Generate a unique run ID for this execution.
 *
 * Format: {timestamp}-{random}
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}

/**
 * Resolve workflow context from various sources.
 *
 * Resolution priority:
 * 1. Explicit CLI args (specDir, linearIssueId)
 * 2. Spec folder detection from branch name
 * 3. Spec folder metadata
 * 4. Defaults
 *
 * @param options Resolution options
 * @returns Resolved workflow context
 */
export function resolveWorkflowContext(
  options: ResolveContextOptions = {}
): WorkflowContext {
  const repoRoot = options.repoRoot || process.cwd()
  const runId = generateRunId()

  let specPath: string | null = null
  let linearIssueId: string | null = null
  let branchName: string | null = options.branch || null
  let resolvedFrom: ContextSource = "default"

  // Priority 1: Explicit CLI args
  if (options.specDir) {
    specPath = options.specDir
    linearIssueId = options.linearIssueId || extractIssueIdFromSpecPath(specPath)
    resolvedFrom = "cli_args"
  }
  // Priority 2: Explicit Linear issue ID
  else if (options.linearIssueId) {
    linearIssueId = options.linearIssueId
    specPath = findSpecFolderByIssueId(linearIssueId, repoRoot)
    resolvedFrom = "cli_args"
  }
  // Priority 3: Branch parsing
  else if (branchName) {
    linearIssueId = parseIssueIdFromBranch(branchName)
    if (linearIssueId) {
      specPath = findSpecFolderByIssueId(linearIssueId, repoRoot)
      resolvedFrom = "branch_parsing"
    }
  }

  // If we found a spec path but no issue ID, try to extract it
  if (specPath && !linearIssueId) {
    linearIssueId = extractIssueIdFromSpecPath(specPath)
  }

  return {
    specPath,
    linearIssueId,
    branchName,
    policy: "optional", // Default policy; will be resolved by preflight
    runId,
    repoRoot,
    resolvedFrom,
  }
}

/**
 * Get the default Linear policy.
 *
 * Resolution order:
 * 1. OPENCODE_LINEAR_POLICY env var
 * 2. project-context.yaml integrations.linear.policy
 * 3. Default: "optional"
 *
 * @returns Linear policy
 */
export function getDefaultLinearPolicy(): LinearPolicy {
  // Check env var first
  const envPolicy = process.env.OPENCODE_LINEAR_POLICY?.toLowerCase()
  if (envPolicy === "off" || envPolicy === "optional" || envPolicy === "required") {
    return envPolicy
  }

  // Default to optional
  return "optional"
}

/**
 * Check if a spec folder has a specific artifact.
 *
 * @param specPath Spec folder path
 * @param artifact Artifact name (e.g., "spec.md", "plan.md")
 * @returns True if artifact exists
 */
export function hasArtifact(specPath: string, artifact: string): boolean {
  const artifactPath = join(specPath, artifact)
  return existsSync(artifactPath)
}

/**
 * Get all artifacts in a spec folder.
 *
 * @param specPath Spec folder path
 * @returns Array of artifact names that exist
 */
export function getExistingArtifacts(specPath: string): string[] {
  const artifacts = ["spec.md", "plan.md", "tasks.md", "status.md", "workflow-state.json"]
  return artifacts.filter((a) => hasArtifact(specPath, a))
}

const WORKFLOW_STATE_FILE = "workflow-state.json"

export function computeArtifactHash(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const content = readFileSync(filePath, "utf-8")
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

export function computeArtifactHashes(specPath: string): Record<string, string> {
  const artifacts = ["spec.md", "plan.md", "tasks.md", "status.md"]
  const hashes: Record<string, string> = {}

  for (const artifact of artifacts) {
    const hash = computeArtifactHash(join(specPath, artifact))
    if (hash) hashes[artifact] = hash
  }

  return hashes
}

export function readWorkflowState(specPath: string): WorkflowState | null {
  const statePath = join(specPath, WORKFLOW_STATE_FILE)
  if (!existsSync(statePath)) return null

  try {
    const content = readFileSync(statePath, "utf-8")
    return JSON.parse(content) as WorkflowState
  } catch {
    return null
  }
}

export function writeWorkflowState(specPath: string, state: WorkflowState): void {
  const statePath = join(specPath, WORKFLOW_STATE_FILE)
  const content = JSON.stringify(state, null, 2)
  writeFileSync(statePath, content, "utf-8")
}

export function createInitialWorkflowState(
  step: WorkflowStep,
  specPath: string,
  linearIssueId: string | null
): WorkflowState {
  const now = new Date().toISOString()
  return {
    currentStep: step,
    completedSteps: [],
    artifactHashes: computeArtifactHashes(specPath),
    linearIssueId,
    linearStatus: null,
    createdAt: now,
    updatedAt: now,
    lastCommand: `/${step}`,
  }
}

export function updateWorkflowState(
  specPath: string,
  step: WorkflowStep,
  linearStatus?: string
): WorkflowState {
  const existing = readWorkflowState(specPath)
  const now = new Date().toISOString()

  if (existing) {
    const completedSteps = existing.completedSteps.includes(existing.currentStep)
      ? existing.completedSteps
      : [...existing.completedSteps, existing.currentStep]

    const updated: WorkflowState = {
      ...existing,
      currentStep: step,
      completedSteps,
      artifactHashes: computeArtifactHashes(specPath),
      linearStatus: linearStatus ?? existing.linearStatus,
      updatedAt: now,
      lastCommand: `/${step}`,
    }

    writeWorkflowState(specPath, updated)
    return updated
  }

  const initial = createInitialWorkflowState(step, specPath, null)
  writeWorkflowState(specPath, initial)
  return initial
}

export interface ArtifactDrift {
  artifact: string
  previousHash: string
  currentHash: string
}

export function detectArtifactDrift(
  specPath: string,
  state: WorkflowState
): ArtifactDrift[] {
  const currentHashes = computeArtifactHashes(specPath)
  const drifts: ArtifactDrift[] = []

  for (const [artifact, previousHash] of Object.entries(state.artifactHashes)) {
    const currentHash = currentHashes[artifact]
    if (currentHash && currentHash !== previousHash) {
      drifts.push({ artifact, previousHash, currentHash })
    }
  }

  return drifts
}

export function formatResumeMessage(state: WorkflowState): string {
  const stepNames: Record<WorkflowStep, string> = {
    specify: "Specification",
    plan: "Planning",
    tasks: "Task Breakdown",
    implement: "Implementation",
    review: "Code Review",
    test: "Testing",
    complete: "Complete",
  }

  const currentName = stepNames[state.currentStep]
  const completedCount = state.completedSteps.length
  const updatedAt = new Date(state.updatedAt).toLocaleDateString()

  return `📋 Resuming from: ${currentName} (${completedCount} steps complete, last updated ${updatedAt})`
}
