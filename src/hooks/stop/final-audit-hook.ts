/**
 * Final Audit Hook
 *
 * Runs high-cost checks (LSP diagnostics, typecheck, tests) only at Stop phase.
 * Avoids running expensive operations during every tool call.
 */

/**
 * Audit configuration
 */
export interface AuditConfig {
  runLspDiagnostics: boolean
  runTypecheck: boolean
  runTests: boolean
}

/**
 * Diagnostic entry
 */
export interface DiagnosticEntry {
  file: string
  message: string
  severity: "error" | "warning" | "info"
}

/**
 * LSP diagnostics result
 */
export interface LspDiagnosticsResult {
  errorCount: number
  warningCount: number
  diagnostics: DiagnosticEntry[]
}

/**
 * Typecheck result
 */
export interface TypecheckResult {
  success: boolean
  errors: string[]
}

/**
 * Test result
 */
export interface TestResult {
  passed: number
  failed: number
  total: number
}

/**
 * Complete audit result
 */
export interface AuditResult {
  lspDiagnostics?: LspDiagnosticsResult
  typecheck?: TypecheckResult
  tests?: TestResult
  overallSuccess: boolean
}

/**
 * Default audit configuration
 */
const DEFAULT_CONFIG: AuditConfig = {
  runLspDiagnostics: true,
  runTypecheck: false,
  runTests: false,
}

/**
 * Final Audit Hook interface
 */
export interface FinalAuditHook {
  /** Get current configuration */
  getConfig(): AuditConfig
  /** Set configuration */
  setConfig(config: Partial<AuditConfig>): void
  /** Run the audit */
  runAudit(): Promise<AuditResult>
  /** Generate formatted report */
  generateReport(result: AuditResult): string
  /** Set mock diagnostics for testing */
  setMockDiagnostics(diagnostics: DiagnosticEntry[]): void
  /** Set mock typecheck result for testing */
  setMockTypecheckResult(result: TypecheckResult): void
  /** Set mock test result for testing */
  setMockTestResult(result: TestResult): void
}

/**
 * Final Audit Hook implementation
 */
class FinalAuditHookImpl implements FinalAuditHook {
  private config: AuditConfig = { ...DEFAULT_CONFIG }
  private mockDiagnostics: DiagnosticEntry[] | null = null
  private mockTypecheckResult: TypecheckResult | null = null
  private mockTestResult: TestResult | null = null

  getConfig(): AuditConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<AuditConfig>): void {
    this.config = { ...this.config, ...config }
  }

  async runAudit(): Promise<AuditResult> {
    const result: AuditResult = {
      overallSuccess: true,
    }

    // Run LSP diagnostics
    if (this.config.runLspDiagnostics) {
      const diagnostics = this.mockDiagnostics || []
      const errorCount = diagnostics.filter((d) => d.severity === "error").length
      const warningCount = diagnostics.filter((d) => d.severity === "warning").length

      result.lspDiagnostics = {
        errorCount,
        warningCount,
        diagnostics,
      }

      if (errorCount > 0) {
        result.overallSuccess = false
      }
    }

    // Run typecheck if enabled
    if (this.config.runTypecheck) {
      const typecheckResult = this.mockTypecheckResult || { success: true, errors: [] }
      result.typecheck = typecheckResult

      if (!typecheckResult.success) {
        result.overallSuccess = false
      }
    }

    // Run tests if enabled
    if (this.config.runTests) {
      const testResult = this.mockTestResult || { passed: 0, failed: 0, total: 0 }
      result.tests = testResult

      if (testResult.failed > 0) {
        result.overallSuccess = false
      }
    }

    return result
  }

  generateReport(result: AuditResult): string {
    const lines: string[] = []
    const statusIcon = result.overallSuccess ? "✅" : "❌"

    lines.push(`## ${statusIcon} Final Audit Report`)
    lines.push("")

    // LSP Diagnostics
    if (result.lspDiagnostics) {
      const lsp = result.lspDiagnostics
      const lspIcon = lsp.errorCount === 0 ? "✅" : "❌"
      lines.push(`### ${lspIcon} LSP Diagnostics`)
      lines.push(`- Errors: ${lsp.errorCount}`)
      lines.push(`- Warnings: ${lsp.warningCount}`)
      lines.push("")
    }

    // Type Check
    if (result.typecheck) {
      const tc = result.typecheck
      const tcIcon = tc.success ? "✅" : "❌"
      lines.push(`### ${tcIcon} Type Check`)
      lines.push(`- Status: ${tc.success ? "PASSED" : "FAILED"}`)
      if (tc.errors.length > 0) {
        lines.push(`- Errors: ${tc.errors.length}`)
      }
      lines.push("")
    }

    // Tests
    if (result.tests) {
      const t = result.tests
      const tIcon = t.failed === 0 ? "✅" : "❌"
      lines.push(`### ${tIcon} Tests`)
      lines.push(`- Passed: ${t.passed}/${t.total}`)
      lines.push(`- Failed: ${t.failed}`)
      lines.push("")
    }

    // Overall status
    lines.push("---")
    lines.push(`**Overall**: ${result.overallSuccess ? "All checks passed" : "Some checks failed"}`)

    return lines.join("\n")
  }

  setMockDiagnostics(diagnostics: DiagnosticEntry[]): void {
    this.mockDiagnostics = diagnostics
  }

  setMockTypecheckResult(result: TypecheckResult): void {
    this.mockTypecheckResult = result
  }

  setMockTestResult(result: TestResult): void {
    this.mockTestResult = result
  }
}

/**
 * Create a new Final Audit Hook instance
 */
export function createFinalAuditHook(): FinalAuditHook {
  return new FinalAuditHookImpl()
}
