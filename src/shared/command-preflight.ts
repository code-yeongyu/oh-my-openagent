import {
  type WorkflowContext,
  type WorkflowStep,
  type WorkflowState,
  resolveWorkflowContext,
  getDefaultLinearPolicy,
  hasArtifact,
  readWorkflowState,
  detectArtifactDrift,
  formatResumeMessage,
} from "./workflow-context"

export type PreflightIssueSeverity = "error" | "warning"

export interface PreflightIssue {
  code: string
  message: string
  severity: PreflightIssueSeverity
}

export interface PreflightFix {
  action: string
  command?: string
  auto?: boolean
}

export interface PreflightResult {
  status: "ok" | "blocked" | "warning"
  context: WorkflowContext
  issues: PreflightIssue[]
  fixes: PreflightFix[]
  workflowState: WorkflowState | null
  resumeMessage: string | null
}

export interface PreflightOptions {
  command: string
  requiredArtifacts?: string[]
  specDir?: string
  linearIssueId?: string
  createSpecFolder?: boolean
  requireLinear?: boolean
  skipLinearUpdate?: boolean
  repoRoot?: string
  branch?: string
}

const ARTIFACT_REQUIREMENTS: Record<WorkflowStep, string[]> = {
  specify: [],
  plan: ["spec.md"],
  tasks: ["spec.md", "plan.md"],
  implement: ["spec.md", "plan.md", "tasks.md"],
  review: ["spec.md"],
  test: ["spec.md"],
  complete: ["spec.md", "plan.md", "tasks.md"],
}

const COMMAND_TO_STEP: Record<string, WorkflowStep> = {
  specify: "specify",
  plan: "plan",
  tasks: "tasks",
  implement: "implement",
  review: "review",
  test: "test",
}

function getRequiredArtifacts(command: string, explicit?: string[]): string[] {
  if (explicit) return explicit
  const step = COMMAND_TO_STEP[command]
  return step ? ARTIFACT_REQUIREMENTS[step] : []
}

function validateLinearPolicy(
  context: WorkflowContext,
  requireLinear: boolean
): PreflightIssue | null {
  if (context.policy === "off") return null
  if (!requireLinear && context.policy !== "required") return null

  if (!context.linearIssueId) {
    const isRequired = requireLinear || context.policy === "required"
    return {
      code: "MISSING_LINEAR",
      message: isRequired
        ? "Linear issue required but not found"
        : "No Linear issue detected (policy: optional)",
      severity: isRequired ? "error" : "warning",
    }
  }
  return null
}

function validateArtifacts(
  context: WorkflowContext,
  required: string[]
): PreflightIssue[] {
  if (!context.specPath) {
    if (required.length > 0) {
      return [
        {
          code: "NO_SPEC_FOLDER",
          message: "No spec folder found",
          severity: "error",
        },
      ]
    }
    return []
  }

  const missing = required.filter((a) => !hasArtifact(context.specPath!, a))
  return missing.map((artifact) => ({
    code: `MISSING_${artifact.replace(/\./g, "_").toUpperCase()}`,
    message: `Required artifact not found: ${artifact}`,
    severity: "error" as const,
  }))
}

function generateFixes(issues: PreflightIssue[]): PreflightFix[] {
  const fixes: PreflightFix[] = []

  for (const issue of issues) {
    switch (issue.code) {
      case "NO_SPEC_FOLDER":
        fixes.push({
          action: "Create spec folder with /specify or manually",
          command: "/specify",
        })
        break
      case "MISSING_SPEC_MD":
        fixes.push({
          action: "Run /specify to create spec.md",
          command: "/specify",
        })
        break
      case "MISSING_PLAN_MD":
        fixes.push({
          action: "Run /plan to create plan.md",
          command: "/plan",
        })
        break
      case "MISSING_TASKS_MD":
        fixes.push({
          action: "Run /tasks to create tasks.md",
          command: "/tasks",
        })
        break
      case "MISSING_LINEAR":
        if (issue.severity === "error") {
          fixes.push({
            action: "Create Linear issue or set OPENCODE_LINEAR_POLICY=optional",
          })
        } else {
          fixes.push({
            action: "Create Linear issue for better tracking (optional)",
          })
        }
        break
    }
  }

  return fixes
}

function determineStatus(issues: PreflightIssue[]): "ok" | "blocked" | "warning" {
  if (issues.some((i) => i.severity === "error")) return "blocked"
  if (issues.some((i) => i.severity === "warning")) return "warning"
  return "ok"
}

export function commandPreflight(options: PreflightOptions): PreflightResult {
  const context = resolveWorkflowContext({
    specDir: options.specDir,
    linearIssueId: options.linearIssueId,
    repoRoot: options.repoRoot,
    branch: options.branch,
  })

  context.policy = getDefaultLinearPolicy()

  const issues: PreflightIssue[] = []
  const requiredArtifacts = getRequiredArtifacts(
    options.command,
    options.requiredArtifacts
  )

  if (!options.createSpecFolder) {
    const artifactIssues = validateArtifacts(context, requiredArtifacts)
    issues.push(...artifactIssues)
  }

  const linearIssue = validateLinearPolicy(
    context,
    options.requireLinear ?? false
  )
  if (linearIssue) {
    issues.push(linearIssue)
  }

  const workflowState = context.specPath
    ? readWorkflowState(context.specPath)
    : null

  const resumeMessage = workflowState ? formatResumeMessage(workflowState) : null

  if (workflowState && context.specPath) {
    const drifts = detectArtifactDrift(context.specPath, workflowState)
    for (const drift of drifts) {
      issues.push({
        code: "ARTIFACT_DRIFT",
        message: `${drift.artifact} changed since last workflow step`,
        severity: "warning",
      })
    }
  }

  const fixes = generateFixes(issues)
  const status = determineStatus(issues)

  return { status, context, issues, fixes, workflowState, resumeMessage }
}

export function formatPreflightResult(result: PreflightResult): string {
  const lines: string[] = []

  if (result.status === "ok") {
    lines.push("✅ Preflight passed")
  } else if (result.status === "warning") {
    lines.push("⚠️ Preflight passed with warnings")
  } else {
    lines.push("❌ Preflight blocked")
  }

  if (result.resumeMessage) {
    lines.push(result.resumeMessage)
  }

  if (result.context.specPath) {
    lines.push(`📁 Spec: ${result.context.specPath}`)
  }
  if (result.context.linearIssueId) {
    lines.push(`🔗 Linear: ${result.context.linearIssueId}`)
  }

  if (result.issues.length > 0) {
    lines.push("")
    lines.push("Issues:")
    for (const issue of result.issues) {
      const icon = issue.severity === "error" ? "❌" : "⚠️"
      lines.push(`  ${icon} ${issue.message}`)
    }
  }

  if (result.fixes.length > 0) {
    lines.push("")
    lines.push("Fixes:")
    for (const fix of result.fixes) {
      lines.push(`  → ${fix.action}`)
      if (fix.command) {
        lines.push(`    Run: ${fix.command}`)
      }
    }
  }

  return lines.join("\n")
}
