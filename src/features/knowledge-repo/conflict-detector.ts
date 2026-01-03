import { readFile, readdir, stat } from "fs/promises"
import { join, relative } from "path"
import picomatch from "picomatch"
import type {
  Constraint,
  ConstraintViolation,
  KnowledgeCommit,
  Severity,
} from "./types"

interface DetectionContext {
  projectRoot: string
  targetFiles?: string[]
}

interface DetectionResult {
  violations: ConstraintViolation[]
  filesScanned: number
  constraintsChecked: number
}

export class ConflictDetector {
  async detect(
    commits: KnowledgeCommit[],
    context: DetectionContext
  ): Promise<DetectionResult> {
    const violations: ConstraintViolation[] = []
    let filesScanned = 0
    let constraintsChecked = 0

    const allConstraints = commits.flatMap((c) =>
      c.constraints.map((constraint) => ({ constraint, knowledgeId: c.id }))
    )

    const files = context.targetFiles ?? (await this.collectFiles(context.projectRoot))
    filesScanned = files.length

    for (const file of files) {
      const relativePath = relative(context.projectRoot, file)

      for (const { constraint, knowledgeId } of allConstraints) {
        constraintsChecked++

        if (!this.shouldApplyConstraint(constraint, relativePath)) continue

        const fileViolations = await this.checkConstraint(
          constraint,
          knowledgeId,
          file,
          relativePath,
          context
        )
        violations.push(...fileViolations)
      }
    }

    return { violations, filesScanned, constraintsChecked }
  }

  async checkFile(
    commits: KnowledgeCommit[],
    filePath: string,
    context: DetectionContext
  ): Promise<ConstraintViolation[]> {
    const violations: ConstraintViolation[] = []
    const relativePath = relative(context.projectRoot, filePath)

    for (const commit of commits) {
      for (const constraint of commit.constraints) {
        if (!this.shouldApplyConstraint(constraint, relativePath)) continue

        const fileViolations = await this.checkConstraint(
          constraint,
          commit.id,
          filePath,
          relativePath,
          context
        )
        violations.push(...fileViolations)
      }
    }

    return violations
  }

  private shouldApplyConstraint(constraint: Constraint, relativePath: string): boolean {
    if (constraint.excludes?.some((pattern) => picomatch.isMatch(relativePath, pattern))) {
      return false
    }

    if (constraint.appliesTo?.length) {
      return constraint.appliesTo.some((pattern) => picomatch.isMatch(relativePath, pattern))
    }

    return true
  }

  private async checkConstraint(
    constraint: Constraint,
    knowledgeId: string,
    filePath: string,
    relativePath: string,
    context: DetectionContext
  ): Promise<ConstraintViolation[]> {
    const violations: ConstraintViolation[] = []

    switch (constraint.operator) {
      case "must_not_use":
        violations.push(
          ...(await this.checkMustNotUse(constraint, knowledgeId, filePath, relativePath))
        )
        break

      case "must_use":
        violations.push(
          ...(await this.checkMustUse(constraint, knowledgeId, filePath, relativePath))
        )
        break

      case "must_match":
        violations.push(
          ...(await this.checkMustMatch(constraint, knowledgeId, filePath, relativePath))
        )
        break

      case "must_not_match":
        violations.push(
          ...(await this.checkMustNotMatch(constraint, knowledgeId, filePath, relativePath))
        )
        break

      case "must_exist":
        violations.push(
          ...(await this.checkMustExist(constraint, knowledgeId, context.projectRoot))
        )
        break

      case "must_not_exist":
        violations.push(
          ...(await this.checkMustNotExist(constraint, knowledgeId, context.projectRoot))
        )
        break
    }

    return violations
  }

  private async checkMustNotUse(
    constraint: Constraint,
    knowledgeId: string,
    filePath: string,
    relativePath: string
  ): Promise<ConstraintViolation[]> {
    const violations: ConstraintViolation[] = []

    if (constraint.target === "code" || constraint.target === "import") {
      try {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n")
        const regex = new RegExp(constraint.pattern, "gi")

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (regex.test(line)) {
            violations.push(
              this.createViolation(constraint, knowledgeId, relativePath, i + 1, line.trim())
            )
          }
          regex.lastIndex = 0
        }
      } catch {
        /* empty */
      }
    }

    if (constraint.target === "dependency") {
      const pkgPath = filePath.endsWith("package.json") ? filePath : null
      if (pkgPath) {
        try {
          const content = await readFile(pkgPath, "utf-8")
          const pkg = JSON.parse(content)
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
          }
          const regex = new RegExp(constraint.pattern, "i")

          for (const depName of Object.keys(allDeps)) {
            if (regex.test(depName)) {
              violations.push(
                this.createViolation(constraint, knowledgeId, relativePath, undefined, depName)
              )
            }
          }
        } catch {
          /* empty */
        }
      }
    }

    return violations
  }

  private async checkMustUse(
    constraint: Constraint,
    knowledgeId: string,
    filePath: string,
    relativePath: string
  ): Promise<ConstraintViolation[]> {
    if (constraint.target !== "code" && constraint.target !== "import") {
      return []
    }

    try {
      const content = await readFile(filePath, "utf-8")
      const regex = new RegExp(constraint.pattern, "gi")

      if (!regex.test(content)) {
        return [
          this.createViolation(
            constraint,
            knowledgeId,
            relativePath,
            undefined,
            `Pattern not found: ${constraint.pattern}`
          ),
        ]
      }
    } catch {
      /* empty */
    }

    return []
  }

  private async checkMustMatch(
    constraint: Constraint,
    knowledgeId: string,
    filePath: string,
    relativePath: string
  ): Promise<ConstraintViolation[]> {
    if (constraint.target === "file") {
      const regex = new RegExp(constraint.pattern)
      if (!regex.test(relativePath)) {
        return [
          this.createViolation(
            constraint,
            knowledgeId,
            relativePath,
            undefined,
            `File path does not match pattern: ${constraint.pattern}`
          ),
        ]
      }
    }

    return []
  }

  private async checkMustNotMatch(
    constraint: Constraint,
    knowledgeId: string,
    filePath: string,
    relativePath: string
  ): Promise<ConstraintViolation[]> {
    const violations: ConstraintViolation[] = []

    if (constraint.target === "file") {
      const regex = new RegExp(constraint.pattern)
      if (regex.test(relativePath)) {
        violations.push(
          this.createViolation(
            constraint,
            knowledgeId,
            relativePath,
            undefined,
            `File path matches forbidden pattern: ${constraint.pattern}`
          )
        )
      }
    }

    if (constraint.target === "code") {
      try {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n")
        const regex = new RegExp(constraint.pattern, "gi")

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (regex.test(line)) {
            violations.push(
              this.createViolation(constraint, knowledgeId, relativePath, i + 1, line.trim())
            )
          }
          regex.lastIndex = 0
        }
      } catch {
        /* empty */
      }
    }

    return violations
  }

  private async checkMustExist(
    constraint: Constraint,
    knowledgeId: string,
    projectRoot: string
  ): Promise<ConstraintViolation[]> {
    const targetPath = join(projectRoot, constraint.pattern)
    try {
      await stat(targetPath)
      return []
    } catch {
      return [
        this.createViolation(
          constraint,
          knowledgeId,
          constraint.pattern,
          undefined,
          `Required file/directory does not exist: ${constraint.pattern}`
        ),
      ]
    }
  }

  private async checkMustNotExist(
    constraint: Constraint,
    knowledgeId: string,
    projectRoot: string
  ): Promise<ConstraintViolation[]> {
    const targetPath = join(projectRoot, constraint.pattern)
    try {
      await stat(targetPath)
      return [
        this.createViolation(
          constraint,
          knowledgeId,
          constraint.pattern,
          undefined,
          `Forbidden file/directory exists: ${constraint.pattern}`
        ),
      ]
    } catch {
      return []
    }
  }

  private createViolation(
    constraint: Constraint,
    knowledgeId: string,
    file: string,
    line?: number,
    match?: string
  ): ConstraintViolation {
    return {
      constraintId: constraint.id,
      knowledgeId,
      severity: constraint.severity,
      message: constraint.message ?? `Constraint violation: ${constraint.operator}`,
      file,
      line,
      match,
      remediation: this.generateRemediation(constraint),
    }
  }

  private generateRemediation(constraint: Constraint): string {
    switch (constraint.operator) {
      case "must_not_use":
        return `Remove usage of: ${constraint.pattern}`
      case "must_use":
        return `Add required pattern: ${constraint.pattern}`
      case "must_match":
        return `Ensure content matches: ${constraint.pattern}`
      case "must_not_match":
        return `Remove content matching: ${constraint.pattern}`
      case "must_exist":
        return `Create required file/directory: ${constraint.pattern}`
      case "must_not_exist":
        return `Remove forbidden file/directory: ${constraint.pattern}`
      default:
        return "Review and fix the constraint violation"
    }
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const files: string[] = []
    const ignoreDirs = ["node_modules", ".git", "dist", "build", ".next", "coverage"]

    async function walk(currentDir: string) {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name)

          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith(".")) {
              await walk(fullPath)
            }
          } else if (entry.isFile()) {
            files.push(fullPath)
          }
        }
      } catch {
        /* empty */
      }
    }

    await walk(dir)
    return files
  }
}

export function groupViolationsBySeverity(
  violations: ConstraintViolation[]
): Record<Severity, ConstraintViolation[]> {
  return {
    block: violations.filter((v) => v.severity === "block"),
    warn: violations.filter((v) => v.severity === "warn"),
    info: violations.filter((v) => v.severity === "info"),
  }
}

export function hasBlockingViolations(violations: ConstraintViolation[]): boolean {
  return violations.some((v) => v.severity === "block")
}
