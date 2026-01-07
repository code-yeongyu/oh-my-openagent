/**
 * Traced Spawn Wrapper
 * 
 * Wraps child_process.spawn and Bun.spawn to automatically log spawn events
 * with redacted command/args for crash debugging.
 */

import { spawn as nodeSpawn, type SpawnOptions, type ChildProcess } from "node:child_process"
import { trace, startSpan, endSpan, isTracingEnabled } from "./tracer"
import { REDACTED_ARG_PATTERNS } from "./constants"

interface TracedSpawnOptions extends SpawnOptions {
  /** Skip tracing for this spawn (default: false) */
  skipTrace?: boolean
  /** Parent span ID for correlation */
  parentSpanId?: string
  /** Custom name for the spawn event */
  traceName?: string
}

/**
 * Redact sensitive arguments from command args
 */
function redactArgs(args: readonly string[]): string[] {
  return args.map((arg, index) => {
    // Check if previous arg was a sensitive flag
    if (index > 0) {
      const prevArg = args[index - 1]
      for (const pattern of REDACTED_ARG_PATTERNS) {
        if (pattern.test(prevArg)) {
          return "[REDACTED]"
        }
      }
    }
    
    // Check if current arg contains sensitive data
    for (const pattern of REDACTED_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        const [flag] = arg.split(/[=\s]/)
        return `${flag}=[REDACTED]`
      }
    }
    
    return arg
  })
}

/**
 * Extract command name from full path for cleaner logs
 */
function getCommandName(command: string): string {
  const parts = command.split(/[/\\]/)
  return parts[parts.length - 1] || command
}

/**
 * Traced spawn using node:child_process
 * Automatically logs spawn start/exit/error events
 */
export function tracedSpawn(
  command: string,
  args: readonly string[] = [],
  options: TracedSpawnOptions = {}
): ChildProcess {
  const { skipTrace, parentSpanId, traceName, ...spawnOptions } = options
  
  const cmdName = getCommandName(command)
  const spanName = traceName || `spawn.${cmdName}`
  
  // Start span if tracing enabled
  let spanId: string | undefined
  if (!skipTrace && isTracingEnabled()) {
    spanId = startSpan("spawn.start", spanName, {
      command: cmdName,
      args: redactArgs(args),
      cwd: spawnOptions.cwd?.toString(),
      detached: spawnOptions.detached,
      stdio: Array.isArray(spawnOptions.stdio) 
        ? spawnOptions.stdio.join(",") 
        : spawnOptions.stdio,
    }, parentSpanId)
  }
  
  const proc = nodeSpawn(command, args as string[], spawnOptions)
  
  if (!skipTrace && isTracingEnabled() && spanId) {
    proc.on("exit", (code, signal) => {
      endSpan(spanId!, {
        exitCode: code,
        signal,
        pid: proc.pid,
      })
    })
    
    proc.on("error", (error) => {
      endSpan(spanId!, { pid: proc.pid }, error)
    })
  }
  
  return proc
}

/**
 * Traced spawn that returns a promise (like the original execCommand pattern)
 */
export function tracedSpawnAsync(
  command: string,
  args: readonly string[] = [],
  options: TracedSpawnOptions = {}
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const proc = tracedSpawn(command, args, options)
    
    proc.on("close", (code, signal) => {
      resolve({ exitCode: code, signal })
    })
    
    proc.on("error", () => {
      resolve({ exitCode: null, signal: null })
    })
  })
}

/**
 * Traced Bun.spawn wrapper
 * For use with Bun's native spawn API
 */
export function tracedBunSpawn(
  command: string | string[],
  options?: {
    cwd?: string
    env?: Record<string, string | undefined>
    stdin?: "pipe" | "inherit" | "ignore" | null
    stdout?: "pipe" | "inherit" | "ignore" | null
    stderr?: "pipe" | "inherit" | "ignore" | null
    /** Skip tracing for this spawn */
    skipTrace?: boolean
    /** Parent span ID */
    parentSpanId?: string
    /** Custom trace name */
    traceName?: string
  }
): ReturnType<typeof Bun.spawn> {
  const cmdArray = Array.isArray(command) ? command : [command]
  const cmdName = getCommandName(cmdArray[0])
  const args = cmdArray.slice(1)
  const spanName = options?.traceName || `bun.spawn.${cmdName}`
  
  // Start span if tracing enabled
  let spanId: string | undefined
  if (!options?.skipTrace && isTracingEnabled()) {
    spanId = startSpan("spawn.start", spanName, {
      command: cmdName,
      args: redactArgs(args),
      cwd: options?.cwd,
    }, options?.parentSpanId)
  }
  
  const proc = Bun.spawn(cmdArray, {
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.stdin,
    stdout: options?.stdout,
    stderr: options?.stderr,
  })
  
  // Track process completion
  if (!options?.skipTrace && isTracingEnabled() && spanId) {
    proc.exited.then((exitCode) => {
      endSpan(spanId!, {
        exitCode,
        pid: proc.pid,
      })
    }).catch((error) => {
      endSpan(spanId!, { pid: proc.pid }, error)
    })
  }
  
  return proc
}

/**
 * Traced Bun.spawnSync wrapper
 */
export function tracedBunSpawnSync(
  command: string | string[],
  options?: {
    cwd?: string
    env?: Record<string, string | undefined>
    stdin?: "pipe" | "inherit" | "ignore" | null
    stdout?: "pipe" | "inherit" | "ignore" | null
    stderr?: "pipe" | "inherit" | "ignore" | null
    skipTrace?: boolean
    parentSpanId?: string
    traceName?: string
  }
): ReturnType<typeof Bun.spawnSync> {
  const cmdArray = Array.isArray(command) ? command : [command]
  const cmdName = getCommandName(cmdArray[0])
  const args = cmdArray.slice(1)
  const spanName = options?.traceName || `bun.spawnSync.${cmdName}`
  
  const startTime = Date.now()
  
  // Log start if tracing enabled
  if (!options?.skipTrace && isTracingEnabled()) {
    trace("spawn.start", `${spanName}.start`, {
      command: cmdName,
      args: redactArgs(args),
      cwd: options?.cwd,
    })
  }
  
  const result = Bun.spawnSync(cmdArray, {
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.stdin,
    stdout: options?.stdout,
    stderr: options?.stderr,
  })
  
  // Log completion
  if (!options?.skipTrace && isTracingEnabled()) {
    const durationMs = Date.now() - startTime
    trace("spawn.exit", `${spanName}.exit`, {
      command: cmdName,
      exitCode: result.exitCode,
      success: result.success,
      durationMs,
    })
  }
  
  return result
}

// Re-export for convenience
export { redactArgs, getCommandName }
