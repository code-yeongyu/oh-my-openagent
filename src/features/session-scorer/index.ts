/**
 * Session Quality Scorer
 *
 * Evaluates session quality based on:
 * - Test coverage (40% weight)
 * - Code quality - no lint/type errors (30% weight)
 * - Task completion rate (30% weight)
 */

/**
 * Quality grade enumeration
 */
export enum QualityGrade {
  A = "A",
  B = "B",
  C = "C",
  D = "D",
  F = "F",
  NA = "N/A",
}

/**
 * Session metrics for scoring
 */
export interface SessionMetrics {
  /** Number of files modified in this session */
  modifiedFiles: number
  /** Number of modified files that have corresponding tests */
  filesWithTests: number
  /** Number of lint errors */
  lintErrors: number
  /** Number of TypeScript/type errors */
  typeErrors: number
  /** Number of tasks completed */
  tasksCompleted: number
  /** Total number of tasks */
  tasksTotal: number
}

/**
 * Score weights for different categories
 */
const WEIGHTS = {
  testCoverage: 0.4,
  codeQuality: 0.3,
  taskCompletion: 0.3,
} as const

/**
 * Penalty points per error type
 */
const PENALTIES = {
  lintError: 2,
  typeError: 5,
} as const

/**
 * Grade thresholds
 */
const GRADE_THRESHOLDS = {
  A: 90,
  B: 80,
  C: 70,
  D: 60,
} as const

/**
 * Session Scorer interface
 */
export interface SessionScorer {
  /** Update metrics for scoring */
  updateMetrics(metrics: SessionMetrics): void
  /** Get overall score (0-100) */
  getScore(): number
  /** Get quality grade (A-F or N/A) */
  getGrade(): QualityGrade
  /** Get test coverage score (0-100) */
  getTestCoverageScore(): number
  /** Get code quality score (0-100) */
  getCodeQualityScore(): number
  /** Get task completion score (0-100) */
  getTaskCompletionScore(): number
  /** Get formatted display string */
  getDisplayString(): string
  /** Reset scorer */
  reset(): void
}

/**
 * Session Scorer implementation
 */
class SessionScorerImpl implements SessionScorer {
  private metrics: SessionMetrics = {
    modifiedFiles: 0,
    filesWithTests: 0,
    lintErrors: 0,
    typeErrors: 0,
    tasksCompleted: 0,
    tasksTotal: 0,
  }

  updateMetrics(metrics: SessionMetrics): void {
    this.metrics = { ...metrics }
  }

  getTestCoverageScore(): number {
    if (this.metrics.modifiedFiles === 0) {
      return 0
    }
    return Math.round(
      (this.metrics.filesWithTests / this.metrics.modifiedFiles) * 100
    )
  }

  getCodeQualityScore(): number {
    const lintPenalty = this.metrics.lintErrors * PENALTIES.lintError
    const typePenalty = this.metrics.typeErrors * PENALTIES.typeError
    const totalPenalty = lintPenalty + typePenalty
    return Math.max(0, 100 - totalPenalty)
  }

  getTaskCompletionScore(): number {
    if (this.metrics.tasksTotal === 0) {
      return 0
    }
    return Math.round(
      (this.metrics.tasksCompleted / this.metrics.tasksTotal) * 100
    )
  }

  getScore(): number {
    // No files modified = no score
    if (this.metrics.modifiedFiles === 0 && this.metrics.tasksTotal === 0) {
      return 0
    }

    const testScore = this.getTestCoverageScore() * WEIGHTS.testCoverage
    const qualityScore = this.getCodeQualityScore() * WEIGHTS.codeQuality
    const completionScore = this.getTaskCompletionScore() * WEIGHTS.taskCompletion

    return Math.round(testScore + qualityScore + completionScore)
  }

  getGrade(): QualityGrade {
    // No activity = N/A
    if (this.metrics.modifiedFiles === 0 && this.metrics.tasksTotal === 0) {
      return QualityGrade.NA
    }

    const score = this.getScore()

    if (score >= GRADE_THRESHOLDS.A) return QualityGrade.A
    if (score >= GRADE_THRESHOLDS.B) return QualityGrade.B
    if (score >= GRADE_THRESHOLDS.C) return QualityGrade.C
    if (score >= GRADE_THRESHOLDS.D) return QualityGrade.D
    return QualityGrade.F
  }

  getDisplayString(): string {
    const grade = this.getGrade()
    const score = this.getScore()

    if (grade === QualityGrade.NA) {
      return "会话质量: N/A (无代码变更)"
    }

    return `会话质量: ${grade} (${score}/100)`
  }

  reset(): void {
    this.metrics = {
      modifiedFiles: 0,
      filesWithTests: 0,
      lintErrors: 0,
      typeErrors: 0,
      tasksCompleted: 0,
      tasksTotal: 0,
    }
  }
}

/**
 * Create a new Session Scorer instance
 */
export function createSessionScorer(): SessionScorer {
  return new SessionScorerImpl()
}
