import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"

import { enumerateProcesses, type ProcessInfo } from "@oh-my-opencode/utils/process-sweep"

/**
 * Session-scoped process isolation for the `bash` tool (issue #6123).
 *
 * Every command runs with `OMO_PROCESS_SCOPE=<session>` exported, so the whole process tree it
 * starts inherits the owning session's tag. Before a command signals processes, the target's tag is
 * read back; a process owned by another session blocks the command. Untagged processes (started
 * outside OmO) stay killable, and `OMO_PROCESS_ISOLATION=off` is an explicit escape hatch. The
 * guard prevents accidents; it is not a sandbox.
 */
export const SCOPE_ENV = "OMO_PROCESS_SCOPE"
export const ISOLATION_ENV = "OMO_PROCESS_ISOLATION"

export function processScope(sessionId: string): string {
  return `omo:${sessionId.replaceAll("'", "")}`
}

export function scopeCommand(command: string, scope: string): string {
  return `export ${SCOPE_ENV}='${scope}'\n${command}`
}

/** Only a leading assignment counts, so a mention in an argument cannot disable isolation. */
export function optsOut(command: string): boolean {
  const tokens = command.trimStart().replace(/^export\s+/, "").split(/[\s;]+/)
  for (const token of tokens) {
    if (!/^[A-Za-z_]\w*=/.test(token)) return false
    if (/^OMO_PROCESS_ISOLATION=(['"]?)off\1$/i.test(token)) return true
  }
  return false
}

interface PatternTarget {
  readonly pattern: string
  readonly full: boolean
  readonly exact: boolean
}

interface Target {
  /** A pid 0/1, group, or otherwise unscopable target: blocked. */
  readonly all: boolean
  readonly pids: readonly number[]
  readonly patterns: readonly PatternTarget[]
}

/** Splits a shell line into simple commands and their words; quotes are honored, operators are not. */
function segments(command: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let word = ""
  let quote = ""
  for (const char of command) {
    if (quote !== "") {
      if (char === quote) quote = ""
      else word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (";&|\n(){}".includes(char)) {
      if (word !== "") words.push(word)
      word = ""
      if (words.length > 0) out.push(words)
      words = []
      continue
    }
    if (/\s/.test(char)) {
      if (word !== "") words.push(word)
      word = ""
      continue
    }
    word += char
  }
  if (word !== "") words.push(word)
  if (words.length > 0) out.push(words)
  return out
}

function programOf(words: readonly string[]): { program: string; args: string[] } | undefined {
  let index = 0
  while (index < words.length) {
    const word = words[index] ?? ""
    if (/^[A-Za-z_]\w*=/.test(word)) {
      index += 1
      continue
    }
    const program = (word.split(/[\\/]/).at(-1) ?? "").toLowerCase()
    if (program === "env") {
      index += 1
      while (index < words.length) {
        const next = words[index] ?? ""
        if (!next.startsWith("-") && !/^[A-Za-z_]\w*=/.test(next)) break
        index += 1
      }
      continue
    }
    if (program === "sudo") {
      index += 1
      while (index < words.length) {
        const next = words[index] ?? ""
        if (/^-[ugpC]$/.test(next)) {
          index += 2
          continue
        }
        if (!next.startsWith("-")) break
        index += 1
      }
      continue
    }
    return { program, args: words.slice(index + 1) }
  }
  return undefined
}

function parseTargets(command: string): Target {
  const pids: number[] = []
  const patterns: PatternTarget[] = []
  let all = false

  for (const words of segments(command)) {
    const head = programOf(words)
    if (head === undefined) continue
    const { program, args } = head

    if (program === "kill") {
      let signal = ""
      let index = 0
      for (; index < args.length; index += 1) {
        const arg = args[index] ?? ""
        if (arg === "--") {
          index += 1
          break
        }
        if (arg === "-s" || arg === "-n") {
          signal = args[index + 1] ?? ""
          index += 1
          continue
        }
        if (arg.startsWith("-")) {
          signal = arg.slice(1)
          continue
        }
        break
      }
      if (signal === "0") continue
      for (; index < args.length; index += 1) {
        const arg = args[index] ?? ""
        if (arg === "--" || arg.startsWith(">") || arg.startsWith("<")) break
        if (!/^-?\d+$/.test(arg)) continue
        const pid = Number(arg)
        if (pid === 0) continue
        if (pid > 1) pids.push(pid)
        else all = true
      }
      continue
    }

    if (program !== "pkill" && program !== "killall") continue
    let full = false
    let exact = program === "killall"
    let unsupported = false
    const positionals: string[] = []
    for (const arg of args) {
      if (arg === "-f") full = true
      else if (arg === "-x") exact = true
      else if (arg.startsWith("-")) unsupported = true
      else positionals.push(arg)
    }
    const pattern = positionals.at(-1)
    if (unsupported || pattern === undefined) continue
    patterns.push({ pattern, full, exact })
  }

  return { all, pids, patterns }
}

const PS_PREFIX = `${SCOPE_ENV}=`

async function readScope(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      const entries = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0")
      return entries.find((entry) => entry.startsWith(PS_PREFIX))?.slice(PS_PREFIX.length)
    }
    if (process.platform === "darwin") return await readPsScope(pid)
  } catch {
    // An unreadable environment is missing evidence, never evidence of a foreign owner.
  }
  return undefined
}

function readPsScope(pid: number): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>()
  execFile(
    "ps",
    ["-E", "-ww", "-p", String(pid), "-o", "command="],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 5_000, windowsHide: true },
    (error, stdout) => {
      resolve(error === null ? new RegExp(`${PS_PREFIX}(\\S+)`).exec(stdout)?.[1] : undefined)
    },
  )
  return promise
}

function matchesPattern(target: PatternTarget, process: ProcessInfo): boolean {
  const name = (process.command.trim().split(/\s+/)[0] ?? "").split(/[\\/]/).at(-1) ?? ""
  const haystack = target.full ? process.command : name
  if (target.exact) return haystack === target.pattern
  try {
    return new RegExp(target.pattern).test(haystack)
  } catch {
    return false
  }
}

function blocked(detail: string): string {
  return `Process isolation blocked this command: ${detail}. Signal only pids your own commands started, or prefix the command with ${ISOLATION_ENV}=off.`
}

const MAX_PATTERN_PROBES = 128

async function readScopeSafely(
  read: (pid: number) => Promise<string | undefined>,
  pid: number,
): Promise<string | undefined> {
  try {
    return await read(pid)
  } catch {
    // An unreadable environment is missing evidence, never evidence of a foreign owner.
    return undefined
  }
}

export interface ProcessIsolationDeps {
  readonly listProcesses?: () => Promise<readonly ProcessInfo[]>
  readonly readScope?: (pid: number) => Promise<string | undefined>
}

/** Returns the block reason, or `undefined` when the command may run. */
export async function processIsolationVerdict(
  command: string,
  ownScope: string,
  deps: ProcessIsolationDeps = {},
): Promise<string | undefined> {
  const targets = parseTargets(command)
  if (targets.all) return blocked("an all-process or group target is not scoped to one session")

  const read = deps.readScope ?? readScope
  for (const pid of targets.pids) {
    const scope = await readScopeSafely(read, pid)
    if (scope !== undefined && scope !== ownScope) return blocked(`pid ${pid} belongs to another OmO session`)
  }

  if (targets.patterns.length === 0) return undefined
  let table: readonly ProcessInfo[]
  try {
    table = await (deps.listProcesses ?? (() => enumerateProcesses()))()
  } catch {
    return undefined
  }
  let probes = 0
  for (const target of targets.patterns) {
    for (const process of table) {
      if (probes >= MAX_PATTERN_PROBES) return undefined
      if (!matchesPattern(target, process)) continue
      probes += 1
      const scope = await readScopeSafely(read, process.pid)
      if (scope !== undefined && scope !== ownScope) return blocked(`pid ${process.pid} belongs to another OmO session`)
    }
  }
  return undefined
}
