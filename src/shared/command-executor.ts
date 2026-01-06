import { spawn } from "child_process"
import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { homedir } from "os"

const DEFAULT_ZSH_PATHS = ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"]
const DEFAULT_BASH_PATHS = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"]

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir()
}

function findShellPath(defaultPaths: string[], customPath?: string): string | null {
  if (customPath && existsSync(customPath)) {
    return customPath
  }
  for (const path of defaultPaths) {
    if (existsSync(path)) {
      return path
    }
  }
  return null
}

function findZshPath(customZshPath?: string): string | null {
  return findShellPath(DEFAULT_ZSH_PATHS, customZshPath)
}

function findBashPath(): string | null {
  return findShellPath(DEFAULT_BASH_PATHS)
}

const execAsync = promisify(exec)

export interface CommandResult {
  exitCode: number
  stdout?: string
  stderr?: string
}

export interface ExecuteHookOptions {
  forceZsh?: boolean
  zshPath?: string
}

/**
 * Execute a hook command with stdin input
 */
export async function executeHookCommand(
  command: string,
  stdin: string,
  cwd: string,
  options?: ExecuteHookOptions
): Promise<CommandResult> {
  const home = getHomeDir()

  let expandedCommand = command
    .replace(/^~(?=\/|$)/g, home)
    .replace(/\s~(?=\/)/g, ` ${home}`)
    .replace(/\$CLAUDE_PROJECT_DIR/g, cwd)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, cwd)

  let finalCommand = expandedCommand

  if (options?.forceZsh) {
    // Always verify shell exists before using it
    const zshPath = findZshPath(options.zshPath)
    const escapedCommand = expandedCommand.replace(/'/g, "'\\''")
    if (zshPath) {
      finalCommand = `${zshPath} -lc '${escapedCommand}'`
    } else {
      // Fall back to bash login shell to preserve PATH from user profile
      const bashPath = findBashPath()
      if (bashPath) {
        finalCommand = `${bashPath} -lc '${escapedCommand}'`
      }
      // If neither zsh nor bash found, fall through to spawn with shell: true
    }
  }

  return new Promise((resolve) => {
    const proc = spawn(finalCommand, {
      cwd,
      shell: true,
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd },
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.stdin?.write(stdin)
    proc.stdin?.end()

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })

    proc.on("error", (err) => {
      resolve({
        exitCode: 1,
        stderr: err.message,
      })
    })
  })
}

/**
 * Execute a simple command and return output
 */
export async function executeCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command)

    const out = stdout?.toString().trim() ?? ""
    const err = stderr?.toString().trim() ?? ""

    if (err) {
      if (out) {
        return `${out}\n[stderr: ${err}]`
      }
      return `[stderr: ${err}]`
    }

    return out
  } catch (error: unknown) {
    const e = error as { stdout?: Buffer; stderr?: Buffer; message?: string }
    const stdout = e?.stdout?.toString().trim() ?? ""
    const stderr = e?.stderr?.toString().trim() ?? ""
    const errMsg = stderr || e?.message || String(error)

    if (stdout) {
      return `${stdout}\n[stderr: ${errMsg}]`
    }
    return `[stderr: ${errMsg}]`
  }
}

/**
 * Find and execute embedded commands in text (!`command`)
 */
interface CommandMatch {
  fullMatch: string
  command: string
  start: number
  end: number
}

const COMMAND_PATTERN = /!`([^`]+)`/g

function findCommands(text: string): CommandMatch[] {
  const matches: CommandMatch[] = []
  let match: RegExpExecArray | null

  COMMAND_PATTERN.lastIndex = 0

  while ((match = COMMAND_PATTERN.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      command: match[1],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return matches
}

/**
 * Resolve embedded commands in text recursively
 */
export async function resolveCommandsInText(
  text: string,
  depth: number = 0,
  maxDepth: number = 3
): Promise<string> {
  if (depth >= maxDepth) {
    return text
  }

  const matches = findCommands(text)
  if (matches.length === 0) {
    return text
  }

  const tasks = matches.map((m) => executeCommand(m.command))
  const results = await Promise.allSettled(tasks)

  const replacements = new Map<string, string>()

  matches.forEach((match, idx) => {
    const result = results[idx]
    if (result.status === "rejected") {
      replacements.set(
        match.fullMatch,
        `[error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}]`
      )
    } else {
      replacements.set(match.fullMatch, result.value)
    }
  })

  let resolved = text
  for (const [pattern, replacement] of replacements.entries()) {
    resolved = resolved.split(pattern).join(replacement)
  }

  if (findCommands(resolved).length > 0) {
    return resolveCommandsInText(resolved, depth + 1, maxDepth)
  }

  return resolved
}
