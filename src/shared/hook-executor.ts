/**
 * Hook Executor with Graceful Degradation
 *
 * Executes hooks with graceful degradation - marks failed hooks as unstable
 * instead of blocking the main flow.
 */

/**
 * Hook execution status
 */
export enum HookStatus {
  SUCCESS = "success",
  UNSTABLE = "unstable",
  SKIPPED = "skipped",
}

/**
 * Hook execution result
 */
export interface HookResult {
  status: HookStatus
  blocked: boolean
  error?: string
  executionTimeMs?: number
}

/**
 * Hook definition
 */
export interface HookDefinition {
  name: string
  timeout?: number
  execute: () => Promise<{ success: boolean }>
}

/**
 * Unstable hook record
 */
export interface UnstableHook {
  name: string
  reason: string
  timestamp: Date
}

/**
 * Logger function type
 */
type LoggerFn = (message: string) => void

/**
 * Default timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30000

/**
 * Hook Executor interface
 */
export interface HookExecutor {
  /** Execute a hook with graceful degradation */
  execute(hook: HookDefinition): Promise<HookResult>
  /** Get list of unstable hooks */
  getUnstableHooks(): UnstableHook[]
  /** Generate execution report */
  generateReport(): string
  /** Set custom logger */
  setLogger(logger: LoggerFn): void
  /** Reset executor state */
  reset(): void
}

/**
 * Execute with timeout helper
 */
async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  hookName: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Hook "${hookName}" timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutId!)
    return result
  } catch (error) {
    clearTimeout(timeoutId!)
    throw error
  }
}

/**
 * Hook Executor implementation
 */
class HookExecutorImpl implements HookExecutor {
  private unstableHooks: UnstableHook[] = []
  private logger: LoggerFn = () => {}

  async execute(hook: HookDefinition): Promise<HookResult> {
    const startTime = Date.now()
    const timeout = hook.timeout || DEFAULT_TIMEOUT

    try {
      await executeWithTimeout(hook.execute(), timeout, hook.name)

      return {
        status: HookStatus.SUCCESS,
        blocked: false,
        executionTimeMs: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Record as unstable
      this.unstableHooks.push({
        name: hook.name,
        reason: errorMessage,
        timestamp: new Date(),
      })

      // Log warning
      this.logger(`[warning] Hook "${hook.name}" marked as unstable: ${errorMessage}`)

      // Graceful degradation - don't block, just mark as unstable
      return {
        status: HookStatus.UNSTABLE,
        blocked: false,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime,
      }
    }
  }

  getUnstableHooks(): UnstableHook[] {
    return [...this.unstableHooks]
  }

  generateReport(): string {
    const lines: string[] = []

    if (this.unstableHooks.length === 0) {
      lines.push("## ✅ Hook Execution Report")
      lines.push("")
      lines.push("All hooks executed successfully.")
      return lines.join("\n")
    }

    lines.push("## ⚠️ Hook Execution Report")
    lines.push("")
    lines.push("### Unstable Hooks")
    lines.push("")

    for (const hook of this.unstableHooks) {
      lines.push(`- **${hook.name}**: ${hook.reason}`)
    }

    lines.push("")
    lines.push(`Total unstable: ${this.unstableHooks.length}`)

    return lines.join("\n")
  }

  setLogger(logger: LoggerFn): void {
    this.logger = logger
  }

  reset(): void {
    this.unstableHooks = []
  }
}

/**
 * Create a new Hook Executor instance
 */
export function createHookExecutor(): HookExecutor {
  return new HookExecutorImpl()
}
