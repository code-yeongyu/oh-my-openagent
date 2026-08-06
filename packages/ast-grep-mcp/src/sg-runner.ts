import { spawn } from "node:child_process";

export const MAX_JSON_RECORD_BYTES = 1024 * 1024;
export const MAX_STDERR_BYTES = 64 * 1024;
export const MAX_MCP_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_MATCHES = 500;
export const DEFAULT_MATCHES = 50;
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MAX_TIMEOUT_MS = 300_000;

export type SgRunnerErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "SG_FAILED"
  | "TIMEOUT";

export type SgTruncationReason = "match_limit" | "output_cap" | "sg_output_truncated" | null;

export interface SgRunnerInput {
  readonly sgPath: string;
  readonly args: readonly string[];
  readonly workdir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxMatches?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SgRunnerResult {
  readonly records: readonly Record<string, unknown>[];
  readonly truncated: boolean;
  readonly reason: SgTruncationReason;
  readonly salvagedRecords: number;
  readonly stderr: string;
  readonly durationMs: number;
  readonly atLeastMatches: number;
  readonly maxPayloadBytes: number;
  readonly exitCode: number | null;
}

export class SgRunnerError extends Error {
  readonly code: SgRunnerErrorCode;
  readonly stderr: string;
  readonly durationMs: number;

  constructor(code: SgRunnerErrorCode, message: string, stderr = "", durationMs = 0) {
    super(message);
    this.name = "SgRunnerError";
    this.code = code;
    this.stderr = stderr;
    this.durationMs = durationMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function decodeStderr(bytes: Buffer): string {
  let start = bytes.length - 1;
  while (start >= 0 && (bytes[start] & 0xc0) === 0x80 && bytes.length - start <= 3) start -= 1;
  const lead = bytes[start];
  const width = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1;
  const complete = start >= 0 && width > bytes.length - start ? bytes.subarray(0, start) : bytes;
  return truncateUtf8(new TextDecoder().decode(complete), MAX_STDERR_BYTES);
}

export async function spawnSgRunner(input: SgRunnerInput): Promise<SgRunnerResult> {
  const startedAt = performance.now();
  if (input.signal?.aborted) throw new SgRunnerError("ABORTED", "ast-grep request was aborted");

  return await new Promise<SgRunnerResult>((resolve, reject) => {
    const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
    const child = spawn(input.sgPath, [...input.args], {
      cwd: input.workdir,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const records: Record<string, unknown>[] = [];
    let serializedRecordsBytes = 2;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let stderrLinePrefix = "";
    let hasSgErrorDiagnostic = false;
    let pending = Buffer.alloc(0);
    let malformed = false;
    let fatalError: SgRunnerErrorCode | null = null;
    let stopReason: "abort" | "limit" | "timeout" | null = null;
    let truncationReason: Exclude<SgTruncationReason, "sg_output_truncated" | null> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const duration = () => Math.max(0, Math.round(performance.now() - startedAt));
    const stderrText = () => decodeStderr(Buffer.concat(stderrChunks));
    const stop = (reason: Exclude<typeof stopReason, null>) => {
      if (stopReason === null) stopReason = reason;
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === "win32") {
        child.kill();
        return;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1_000);
      killTimer.unref();
    };
    const failOutput = (code: SgRunnerErrorCode) => {
      fatalError ??= code;
      stop("limit");
    };
    const parseLine = (line: Buffer): boolean => {
      const value = line.length > 0 && line[line.length - 1] === 13 ? line.subarray(0, -1) : line;
      if (value.length === 0) return true;
      if (value.length > MAX_JSON_RECORD_BYTES) {
        failOutput("OUTPUT_TOO_LARGE");
        return false;
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(value);
      } catch {
        failOutput("ENCODING_ERROR");
        return false;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed)) throw new Error("record is not an object");
        const serializedBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
        const nextAggregateBytes = serializedRecordsBytes + serializedBytes + (records.length > 0 ? 1 : 0);
        if (nextAggregateBytes > MAX_MCP_PAYLOAD_BYTES) {
          truncationReason = "output_cap";
          stop("limit");
          child.stdout.pause();
          return false;
        }
        records.push(parsed);
        serializedRecordsBytes = nextAggregateBytes;
        if (records.length > maxMatches) {
          records.length = maxMatches;
          truncationReason = "match_limit";
          stop("limit");
          child.stdout.pause();
          return false;
        }
      } catch {
        malformed = true;
      }
      return true;
    };

    const timeout = setTimeout(() => stop("timeout"), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref();
    const onAbort = () => stop("abort");
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stopReason === "limit") return;
      pending = Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        if (!parseLine(line)) return;
        newline = pending.indexOf(10);
      }
      if (pending.length > MAX_JSON_RECORD_BYTES) failOutput("OUTPUT_TOO_LARGE");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!hasSgErrorDiagnostic) {
        for (const byte of chunk) {
          if (byte === 10 || byte === 13) {
            stderrLinePrefix = "";
          } else if (stderrLinePrefix.length < 80) {
            stderrLinePrefix += String.fromCharCode(byte);
            if (/^[\t ]*(?:ERROR\b|error:)/.test(stderrLinePrefix)) hasSgErrorDiagnostic = true;
          }
        }
      }
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      if (remaining <= 0) return;
      const kept = chunk.subarray(0, remaining);
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(new SgRunnerError("SG_FAILED", error.message, stderrText(), duration()));
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      const stderr = stderrText();
      if (stopReason === "abort") return reject(new SgRunnerError("ABORTED", "ast-grep request was aborted", stderr, duration()));
      if (stopReason === "timeout") return reject(new SgRunnerError("TIMEOUT", "ast-grep request timed out", stderr, duration()));
      if (fatalError) return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      if (stopReason !== "limit" && pending.length > 0) parseLine(pending);
      if (fatalError) return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      const failedExit = exitCode !== 0 && exitCode !== 1;
      const diagnosedExitOne = exitCode === 1 && hasSgErrorDiagnostic;
      if (stopReason === null && (failedExit || diagnosedExitOne)) {
        return reject(new SgRunnerError("SG_FAILED", `ast-grep exited with code ${exitCode ?? "unknown"}`, stderr, duration()));
      }
      if (malformed && records.length === 0) return reject(new SgRunnerError("OUTPUT_PARSE_FAILED", "ast-grep produced no parseable JSON records", stderr, duration()));
      const limited = stopReason === "limit" && truncationReason !== null;
      const salvaged = malformed && records.length > 0;
      resolve({
        records,
        truncated: limited || salvaged,
        reason: limited ? truncationReason : salvaged ? "sg_output_truncated" : null,
        salvagedRecords: salvaged ? records.length : 0,
        stderr,
        durationMs: duration(),
        atLeastMatches: limited ? records.length + 1 : records.length,
        maxPayloadBytes: MAX_MCP_PAYLOAD_BYTES,
        exitCode,
      });
    });
  });
}
