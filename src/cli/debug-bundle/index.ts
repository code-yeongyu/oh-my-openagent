/**
 * Debug Bundle CLI Command
 * 
 * Creates a diagnostic bundle for crash debugging.
 * Collects trace logs, environment info, and system state.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import pc from "picocolors"
import { 
  getDefaultLogFilePath, 
  createDiagnosticBundle,
  DEBUG_ENV_VAR,
  DEBUG_LOG_PATH_VAR,
} from "../../shared/debug-tracer"

export interface DebugBundleOptions {
  output?: string
  verbose?: boolean
}

export async function debugBundle(options: DebugBundleOptions): Promise<number> {
  const verbose = options.verbose ?? false
  
  console.log(pc.cyan("\n📦 Creating Debug Bundle\n"))
  
  // Check if tracing was enabled
  const tracingWasEnabled = process.env[DEBUG_ENV_VAR] === "1"
  const logFilePath = process.env[DEBUG_LOG_PATH_VAR] || getDefaultLogFilePath()
  
  console.log(pc.dim(`  Trace log path: ${logFilePath}`))
  console.log(pc.dim(`  Tracing enabled: ${tracingWasEnabled ? "yes" : "no"}\n`))
  
  // Create bundle
  const bundle: Record<string, unknown> = {
    createdAt: new Date().toISOString(),
    version: "2.14.1-debug.1",
    tracing: {
      wasEnabled: tracingWasEnabled,
      logFilePath,
      envVar: DEBUG_ENV_VAR,
      logPathVar: DEBUG_LOG_PATH_VAR,
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpuCores: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024),
      freeMemory: Math.round(os.freemem() / 1024 / 1024),
      hostname: os.hostname().replace(/[^a-zA-Z0-9-]/g, "[REDACTED]"),
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "N/A",
      cwd: process.cwd().replace(os.homedir(), "~"),
    },
    env: getRedactedEnv(),
    traceEvents: [],
    recentLogs: [],
  }
  
  // Read trace log if exists
  if (fs.existsSync(logFilePath)) {
    try {
      const content = fs.readFileSync(logFilePath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      
      // Parse as JSONL
      const events: unknown[] = []
      for (const line of lines.slice(-500)) { // Last 500 events
        try {
          events.push(JSON.parse(line))
        } catch {
          // Skip malformed lines
        }
      }
      bundle.traceEvents = events
      console.log(pc.green(`  ✓ Found ${events.length} trace events`))
    } catch (err) {
      console.log(pc.yellow(`  ⚠ Could not read trace log: ${err}`))
    }
  } else {
    console.log(pc.yellow("  ⚠ No trace log found"))
    console.log(pc.dim(`    Run with ${DEBUG_ENV_VAR}=1 to enable tracing\n`))
  }
  
  // Read regular log if exists
  const regularLogPath = path.join(os.tmpdir(), "oh-my-opencode.log")
  if (fs.existsSync(regularLogPath)) {
    try {
      const content = fs.readFileSync(regularLogPath, "utf-8")
      const lines = content.trim().split("\n").slice(-100) // Last 100 lines
      bundle.recentLogs = lines
      console.log(pc.green(`  ✓ Found ${lines.length} recent log entries`))
    } catch {
      // Ignore
    }
  }
  
  // Determine output path
  const outputPath = options.output || path.join(
    os.tmpdir(),
    `oh-my-opencode-debug-bundle-${Date.now()}.json`
  )
  
  // Write bundle
  try {
    fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2))
    console.log(pc.green(`\n✓ Bundle created: ${outputPath}`))
    console.log(pc.dim(`  Size: ${Math.round(fs.statSync(outputPath).size / 1024)}KB\n`))
    
    console.log(pc.cyan("Next steps:"))
    console.log(pc.dim("  1. Share this bundle when reporting crash issues"))
    console.log(pc.dim("  2. The bundle contains redacted environment info"))
    console.log(pc.dim("  3. Review the file before sharing to ensure no secrets\n"))
    
    return 0
  } catch (err) {
    console.error(pc.red(`\n✗ Failed to create bundle: ${err}`))
    return 1
  }
}

function getRedactedEnv(): Record<string, string> {
  const redactedKeys = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NPM_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AZURE_CLIENT_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "MONGODB_URI",
  ])
  
  const relevantKeys = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SHELL",
    "TERM",
    "NODE_ENV",
    "BUN_INSTALL",
    "CI",
    "GITHUB_ACTIONS",
    DEBUG_ENV_VAR,
    DEBUG_LOG_PATH_VAR,
    "OPENCODE_RUN",
    "OPENCODE_NON_INTERACTIVE",
  ]
  
  const result: Record<string, string> = {}
  
  for (const key of relevantKeys) {
    const value = process.env[key]
    if (value) {
      if (redactedKeys.has(key)) {
        result[key] = "[REDACTED]"
      } else if (key === "PATH") {
        result[key] = value.split(path.delimiter).length + " entries"
      } else if (key === "HOME" || key === "USERPROFILE") {
        result[key] = "[HOME]"
      } else {
        result[key] = value
      }
    }
  }
  
  return result
}
