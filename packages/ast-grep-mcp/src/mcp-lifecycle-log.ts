import { appendFileSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type LogFieldValue = boolean | number | string | null;

const LOG_FILE_NAME = "omo-ast-grep-mcp.log";
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function mcpLifecycleLogPath(): string {
  return join(tmpdir(), LOG_FILE_NAME);
}

export function writeMcpLifecycleLog(event: string, fields: Record<string, LogFieldValue> = {}): void {
  const path = mcpLifecycleLogPath();
  try {
    rotateLogIfNeeded(path);
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), event, pid: process.pid, ppid: process.ppid, ...fields })}\n`);
  } catch {
    // best-effort log write — never throws
  }
}

function rotateLogIfNeeded(path: string): void {
  try {
    if (statSync(path).size < MAX_LOG_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // best-effort log rotation — never throws
  }
}
