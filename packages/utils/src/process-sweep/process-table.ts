/**
 * Generic process-table parsing shared by every sweep family.
 *
 * A family is a classifier over this table (see `./codegraph-family` and
 * `./lsp-proxy-family`) plus a kill plan executed by `./sweeper`.
 */

export interface ProcessInfo {
  readonly command: string
  readonly pid: number
  readonly ppid: number
}

/** Backward-compatible alias: the codegraph family was the first consumer. */
export type CodegraphProcessInfo = ProcessInfo

export function parsePosixProcessTable(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3]
    if (!isValidProcessId(pid) || !Number.isInteger(ppid) || ppid < 0 || command === undefined) continue
    processes.push({ command, pid, ppid })
  }
  return processes
}

export function parseWindowsProcessTable(output: string): ProcessInfo[] {
  const parsed = parseJson(output)
  const entries = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed]
  const processes: ProcessInfo[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const pid = numberField(entry, "ProcessId")
    const ppid = numberField(entry, "ParentProcessId")
    const command = stringField(entry, "CommandLine")
    if (pid === undefined || ppid === undefined || command === undefined || command.trim().length === 0) continue
    processes.push({ command, pid, ppid })
  }
  return processes
}

export function isOrphaned(processInfo: ProcessInfo, livePids: ReadonlySet<number>): boolean {
  return processInfo.ppid === 1 || !livePids.has(processInfo.ppid)
}

function isValidProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && isValidProcessId(value) ? value : undefined
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
