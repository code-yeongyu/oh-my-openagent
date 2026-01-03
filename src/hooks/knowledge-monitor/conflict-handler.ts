import { writeFile, mkdir } from "fs/promises"
import { dirname, join, relative } from "path"
import { tmpdir } from "os"
import { ConflictDetector, groupViolationsBySeverity, hasBlockingViolations } from "../../features/knowledge-repo/conflict-detector"
import type { KnowledgeCommit, ConstraintViolation, Severity } from "../../features/knowledge-repo/types"
import type { PendingToolCall, ViolationReport, MonitorContext } from "./types"
import { SEVERITY_PRIORITY } from "./constants"

export class ConflictHandler {
  private detector: ConflictDetector
  private activeKnowledge: KnowledgeCommit[] = []
  private projectRoot: string

  constructor(projectRoot: string) {
    this.detector = new ConflictDetector()
    this.projectRoot = projectRoot
  }

  setActiveKnowledge(knowledge: KnowledgeCommit[]): void {
    this.activeKnowledge = knowledge
  }

  getActiveKnowledge(): KnowledgeCommit[] {
    return this.activeKnowledge
  }

  async checkFileWrite(
    filePath: string,
    content: string,
    context: MonitorContext
  ): Promise<ViolationReport | null> {
    if (this.activeKnowledge.length === 0) return null

    const tempDir = join(tmpdir(), "knowledge-monitor", context.sessionId)
    await mkdir(tempDir, { recursive: true })
    const tempFile = join(tempDir, `temp-${Date.now()}.check`)
    
    try {
      await writeFile(tempFile, content, "utf-8")
      
      const violations = await this.detector.checkFile(
        this.activeKnowledge,
        tempFile,
        { projectRoot: this.projectRoot, targetFiles: [tempFile] }
      )

      if (violations.length === 0) return null

      const relPath = relative(this.projectRoot, filePath)
      const mappedViolations = violations.map(v => ({
        ...v,
        file: relPath,
      }))

      return this.createReport(mappedViolations)
    } catch {
      return null
    }
  }

  async checkFileEdit(
    filePath: string,
    oldString: string,
    newString: string,
    context: MonitorContext
  ): Promise<ViolationReport | null> {
    if (this.activeKnowledge.length === 0) return null

    const codeConstraints = this.activeKnowledge.filter(k =>
      k.constraints.some(c => c.target === "code" || c.target === "import")
    )
    if (codeConstraints.length === 0) return null

    const violations: ConstraintViolation[] = []

    for (const commit of codeConstraints) {
      for (const constraint of commit.constraints) {
        if (constraint.target !== "code" && constraint.target !== "import") continue

        if (constraint.operator === "must_not_use" || constraint.operator === "must_not_match") {
          const newRegex = new RegExp(constraint.pattern, "gi")
          const oldRegex = new RegExp(constraint.pattern, "gi")
          const inNew = newRegex.test(newString)
          const inOld = oldRegex.test(oldString)
          if (inNew && !inOld) {
            violations.push({
              constraintId: constraint.id,
              knowledgeId: commit.id,
              severity: constraint.severity,
              message: constraint.message ?? `Edit introduces forbidden pattern: ${constraint.pattern}`,
              file: relative(this.projectRoot, filePath),
              match: newString.substring(0, 100),
              remediation: `Avoid introducing: ${constraint.pattern}`,
            })
          }
        }
      }
    }

    if (violations.length === 0) return null
    return this.createReport(violations)
  }

  async checkBashCommand(
    command: string,
    context: MonitorContext
  ): Promise<ViolationReport | null> {
    if (this.activeKnowledge.length === 0) return null

    const violations: ConstraintViolation[] = []

    for (const commit of this.activeKnowledge) {
      for (const constraint of commit.constraints) {
        if (constraint.target !== "code") continue

        if (constraint.operator === "must_not_use" || constraint.operator === "must_not_match") {
          const regex = new RegExp(constraint.pattern, "gi")
          if (regex.test(command)) {
            violations.push({
              constraintId: constraint.id,
              knowledgeId: commit.id,
              severity: constraint.severity,
              message: constraint.message ?? `Command uses forbidden pattern: ${constraint.pattern}`,
              match: command.substring(0, 100),
              remediation: `Avoid command containing: ${constraint.pattern}`,
            })
          }
        }
      }
    }

    if (violations.length === 0) return null
    return this.createReport(violations)
  }

  async checkPendingCall(call: PendingToolCall): Promise<ViolationReport | null> {
    if (call.filePath && call.content) {
      return this.checkFileWrite(call.filePath, call.content, call.context)
    }

    if (call.filePath && call.oldString && call.newString) {
      return this.checkFileEdit(call.filePath, call.oldString, call.newString, call.context)
    }

    if (call.edits && call.filePath) {
      const allViolations: ConstraintViolation[] = []
      for (const edit of call.edits) {
        const report = await this.checkFileEdit(
          call.filePath,
          edit.old_string,
          edit.new_string,
          call.context
        )
        if (report) allViolations.push(...report.violations)
      }
      if (allViolations.length === 0) return null
      return this.createReport(allViolations)
    }

    if (call.command) {
      return this.checkBashCommand(call.command, call.context)
    }

    return null
  }

  private createReport(violations: ConstraintViolation[]): ViolationReport {
    const grouped = groupViolationsBySeverity(violations)
    const highestSeverity = this.getHighestSeverity(violations)
    const shouldBlock = hasBlockingViolations(violations)
    const relatedKnowledge = this.getRelatedKnowledge(violations)

    return {
      violations,
      highestSeverity,
      message: this.formatViolationMessage(violations, grouped),
      shouldBlock,
      relatedKnowledge,
    }
  }

  private getHighestSeverity(violations: ConstraintViolation[]): Severity {
    let highest: Severity = "info"
    let highestPriority = 0

    for (const v of violations) {
      const priority = SEVERITY_PRIORITY[v.severity] ?? 0
      if (priority > highestPriority) {
        highestPriority = priority
        highest = v.severity
      }
    }

    return highest
  }

  private getRelatedKnowledge(violations: ConstraintViolation[]): KnowledgeCommit[] {
    const ids = new Set(violations.map(v => v.knowledgeId))
    return this.activeKnowledge.filter(k => ids.has(k.id))
  }

  private formatViolationMessage(
    violations: ConstraintViolation[],
    grouped: Record<Severity, ConstraintViolation[]>
  ): string {
    const lines: string[] = []

    if (grouped.block.length > 0) {
      lines.push("## BLOCKING VIOLATIONS")
      for (const v of grouped.block) {
        lines.push(this.formatSingleViolation(v))
      }
      lines.push("")
    }

    if (grouped.warn.length > 0) {
      lines.push("## WARNINGS")
      for (const v of grouped.warn) {
        lines.push(this.formatSingleViolation(v))
      }
      lines.push("")
    }

    if (grouped.info.length > 0) {
      lines.push("## INFO")
      for (const v of grouped.info) {
        lines.push(this.formatSingleViolation(v))
      }
    }

    return lines.join("\n")
  }

  private formatSingleViolation(v: ConstraintViolation): string {
    const parts = [`- **${v.message}**`]
    if (v.file) parts.push(`  File: ${v.file}`)
    if (v.line) parts.push(`  Line: ${v.line}`)
    if (v.match) parts.push(`  Match: \`${v.match}\``)
    if (v.remediation) parts.push(`  Fix: ${v.remediation}`)
    return parts.join("\n")
  }
}
