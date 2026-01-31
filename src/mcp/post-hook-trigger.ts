/**
 * Post-Hook Trigger - MCP 后置钩子触发器
 *
 * MCP 修改代码后自动触发 LSP 诊断，确保代码变更不引入类型错误。
 */

export interface Diagnostic {
  file: string
  line: number
  message: string
  severity: "error" | "warning" | "info"
}

export interface PostHookConfig {
  enabled: boolean
  timeoutMs: number
}

export interface LspProviderOptions {
  lspProvider: () => Promise<Diagnostic[]>
}

export interface TriggerResult {
  triggered: boolean
  diagnostics: Diagnostic[]
  skipped?: boolean
  reason?: string
  error?: string
}

export interface PostHookTrigger {
  triggerLspDiagnostics(
    filePath: string,
    options: LspProviderOptions
  ): Promise<TriggerResult>
  getContextInjection(): string
  clearDiagnostics(): void
}

/**
 * Creates a post-hook trigger for MCP operations.
 *
 * Automatically triggers LSP diagnostics after code modifications.
 */
export function createPostHookTrigger(config: PostHookConfig): PostHookTrigger {
  let storedDiagnostics: Diagnostic[] = []

  async function triggerLspDiagnostics(
    filePath: string,
    options: LspProviderOptions
  ): Promise<TriggerResult> {
    // Skip if disabled
    if (!config.enabled) {
      return {
        triggered: false,
        diagnostics: [],
        skipped: true,
        reason: "disabled",
      }
    }

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<Diagnostic[]>((_, reject) => {
        setTimeout(() => reject(new Error("LSP diagnostics timeout")), config.timeoutMs)
      })

      // Race between LSP provider and timeout
      const diagnostics = await Promise.race([
        options.lspProvider(),
        timeoutPromise,
      ])

      storedDiagnostics = diagnostics

      return {
        triggered: true,
        diagnostics,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        triggered: false,
        diagnostics: [],
        error: errorMessage,
      }
    }
  }

  function getContextInjection(): string {
    if (storedDiagnostics.length === 0) {
      return ""
    }

    const lines = storedDiagnostics.map(
      (d) => `[${d.severity.toUpperCase()}] ${d.file}:${d.line} - ${d.message}`
    )

    return `## LSP Diagnostics\n${lines.join("\n")}`
  }

  function clearDiagnostics(): void {
    storedDiagnostics = []
  }

  return {
    triggerLspDiagnostics,
    getContextInjection,
    clearDiagnostics,
  }
}
