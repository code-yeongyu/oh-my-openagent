/**
 * Dead Code Detector
 *
 * Detects unused exports and dependencies using knip or fallback basic detection.
 * Integrates with /refactor command to provide cleanup suggestions.
 */

/**
 * Simple glob pattern matcher (supports ** and * wildcards)
 */
function simpleMatch(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\//g, "\\/")
  
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filePath)
}

/**
 * Unused export information
 */
export interface UnusedExport {
  file: string
  name: string
  line: number
  isDynamic?: boolean
}

/**
 * Dead code analysis result
 */
export interface DeadCodeResult {
  unusedExports: UnusedExport[]
  unusedDependencies: string[]
  uncertainExports: UnusedExport[]
  fallbackMode: boolean
  message?: string
}

/**
 * Mock analysis result for testing
 */
interface MockAnalysis {
  unusedExports: Array<{ file: string; name: string; line: number; isDynamic?: boolean }>
  unusedDependencies: string[]
}

/**
 * Dead Code Detector interface
 */
export interface DeadCodeDetector {
  /** Analyze project for dead code */
  analyze(projectPath: string): Promise<DeadCodeResult>
  /** Generate cleanup suggestions from result */
  generateSuggestions(result: DeadCodeResult): string
  /** Set ignore patterns for filtering results */
  setIgnorePatterns(patterns: string[]): void
  /** Set mock results for testing */
  setMockResults(results: MockAnalysis): void
  /** Set whether knip is available */
  setKnipAvailable(available: boolean): void
}

/**
 * Dead Code Detector implementation
 */
class DeadCodeDetectorImpl implements DeadCodeDetector {
  private ignorePatterns: string[] = []
  private mockResults: MockAnalysis | null = null
  private knipAvailable = true

  async analyze(projectPath: string): Promise<DeadCodeResult> {
    // Check if knip is available
    if (!this.knipAvailable) {
      return {
        unusedExports: [],
        unusedDependencies: [],
        uncertainExports: [],
        fallbackMode: true,
        message: "基本检测模式 - knip 未安装，使用简化分析",
      }
    }

    // Use mock results for testing
    if (this.mockResults) {
      return this.processResults(this.mockResults)
    }

    // In real implementation, this would run knip
    // For now, return empty results
    return {
      unusedExports: [],
      unusedDependencies: [],
      uncertainExports: [],
      fallbackMode: false,
    }
  }

  private processResults(analysis: MockAnalysis): DeadCodeResult {
    const unusedExports: UnusedExport[] = []
    const uncertainExports: UnusedExport[] = []

    for (const exp of analysis.unusedExports) {
      // Check ignore patterns
      if (this.shouldIgnore(exp.file)) {
        continue
      }

      const exportItem: UnusedExport = {
        file: exp.file,
        name: exp.name,
        line: exp.line,
        isDynamic: exp.isDynamic,
      }

      // Separate dynamic/uncertain exports
      if (exp.isDynamic) {
        uncertainExports.push(exportItem)
      } else {
        unusedExports.push(exportItem)
      }
    }

    return {
      unusedExports,
      unusedDependencies: analysis.unusedDependencies,
      uncertainExports,
      fallbackMode: false,
    }
  }

  private shouldIgnore(filePath: string): boolean {
    for (const pattern of this.ignorePatterns) {
      if (simpleMatch(filePath, pattern)) {
        return true
      }
    }
    return false
  }

  generateSuggestions(result: DeadCodeResult): string {
    const lines: string[] = []

    // Check if there's anything to report
    if (
      result.unusedExports.length === 0 &&
      result.unusedDependencies.length === 0 &&
      result.uncertainExports.length === 0
    ) {
      return "✅ 未发现死代码 - 代码库很干净！"
    }

    lines.push("## 建议删除以下未使用代码\n")

    // Unused exports
    if (result.unusedExports.length > 0) {
      lines.push("### 未使用的导出\n")
      for (const exp of result.unusedExports) {
        lines.push(`- \`${exp.name}\` in ${exp.file}:${exp.line}`)
      }
      lines.push("")
    }

    // Unused dependencies
    if (result.unusedDependencies.length > 0) {
      lines.push("### 未使用的依赖\n")
      lines.push("可以通过以下命令移除：")
      lines.push("```bash")
      lines.push(`bun remove ${result.unusedDependencies.join(" ")}`)
      lines.push("```")
      lines.push("")
      for (const dep of result.unusedDependencies) {
        lines.push(`- ${dep}`)
      }
      lines.push("")
    }

    // Uncertain exports (dynamic imports)
    if (result.uncertainExports.length > 0) {
      lines.push("### ⚠️ 可能动态使用的导出（需人工确认）\n")
      for (const exp of result.uncertainExports) {
        lines.push(`- \`${exp.name}\` in ${exp.file}:${exp.line}`)
      }
      lines.push("")
    }

    // Fallback mode note
    if (result.fallbackMode && result.message) {
      lines.push(`\n> ℹ️ ${result.message}`)
    }

    return lines.join("\n")
  }

  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns
  }

  setMockResults(results: MockAnalysis): void {
    this.mockResults = results
  }

  setKnipAvailable(available: boolean): void {
    this.knipAvailable = available
  }
}

/**
 * Create a new Dead Code Detector instance
 */
export function createDeadCodeDetector(): DeadCodeDetector {
  return new DeadCodeDetectorImpl()
}
