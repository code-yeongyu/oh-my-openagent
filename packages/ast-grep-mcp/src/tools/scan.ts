import { normalizeRecords, type NormalizedMatch } from "../normalize";
import {
  DEFAULT_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_MATCHES,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "../sg-runner";

const MAX_PATHS = 64;
const MAX_GLOBS = 32;
const MIN_TIMEOUT_MS = 1_000;
const MAX_PATH_LENGTH = 4_096;
const MAX_GLOB_LENGTH = 1_024;
const MAX_INLINE_RULE_BYTES = 64 * 1_024;

export const SCAN_TOOL_NAME = "scan" as const;
export const SCAN_TOOL_DESCRIPTION =
  "Scan files with exactly one explicit ast-grep YAML rule source. Provide either ruleFile or inlineRules; ambient sgconfig.yml discovery is never used. Dry-run is the default. Apply uses a bounded JSON preview followed by a separate plain --update-all pass, and truncated previews are never applied.";

export interface ScanInput {
  readonly ruleFile?: string;
  readonly inlineRules?: string;
  readonly paths: readonly string[];
  readonly workdir?: string;
  readonly globs?: readonly string[];
  readonly maxMatches: number;
  readonly timeoutMs: number;
  readonly includeHidden?: boolean;
  readonly followSymlinks?: boolean;
  readonly includeMetadata: boolean;
  readonly apply: boolean;
}

/** JSON Schema maxLength counts Unicode code points, not UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

const KNOWN_KEYS = new Set([
  "ruleFile",
  "inlineRules",
  "paths",
  "workdir",
  "globs",
  "maxMatches",
  "timeoutMs",
  "includeHidden",
  "followSymlinks",
  "includeMetadata",
  "apply",
]);

function parseScanInput(input: unknown): ScanInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown property: ${key}`);
  }

  const hasRuleFile = obj.ruleFile !== undefined;
  const hasInlineRules = obj.inlineRules !== undefined;
  if (hasRuleFile === hasInlineRules) {
    throw new Error("Exactly one of ruleFile or inlineRules must be provided");
  }
  if (hasRuleFile && (typeof obj.ruleFile !== "string" || obj.ruleFile.length === 0)) {
    throw new Error("ruleFile must be a non-empty string");
  }
  if (typeof obj.ruleFile === "string" && codePointLength(obj.ruleFile) > MAX_PATH_LENGTH) {
    throw new Error(`ruleFile must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (hasInlineRules && (typeof obj.inlineRules !== "string" || obj.inlineRules.length === 0)) {
    throw new Error("inlineRules must be a non-empty string");
  }
  if (typeof obj.inlineRules === "string" && Buffer.byteLength(obj.inlineRules, "utf8") > MAX_INLINE_RULE_BYTES) {
    throw new Error("inlineRules must be at most 64KiB");
  }

  if (!Array.isArray(obj.paths)) throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    throw new Error(`paths must have 1-${MAX_PATHS} entries`);
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0) throw new Error("each path must be a non-empty string");
    if (codePointLength(path) > MAX_PATH_LENGTH) throw new Error(`each path must be at most ${MAX_PATH_LENGTH} characters`);
  }

  if (obj.workdir !== undefined && (typeof obj.workdir !== "string" || obj.workdir.length === 0)) {
    throw new Error("workdir must be a non-empty string");
  }
  if (typeof obj.workdir === "string" && codePointLength(obj.workdir) > MAX_PATH_LENGTH) {
    throw new Error(`workdir must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS) throw new Error(`globs must have at most ${MAX_GLOBS} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0) throw new Error("each glob must be a non-empty string");
      if (codePointLength(glob) > MAX_GLOB_LENGTH) throw new Error(`each glob must be at most ${MAX_GLOB_LENGTH} characters`);
    }
  }

  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (
      typeof obj.maxMatches !== "number" ||
      !Number.isInteger(obj.maxMatches) ||
      obj.maxMatches < 1 ||
      obj.maxMatches > MAX_MATCHES
    ) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (
      typeof obj.timeoutMs !== "number" ||
      !Number.isInteger(obj.timeoutMs) ||
      obj.timeoutMs < MIN_TIMEOUT_MS ||
      obj.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }

  for (const flag of ["includeHidden", "followSymlinks", "includeMetadata", "apply"] as const) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") throw new Error(`${flag} must be a boolean`);
  }

  return {
    ruleFile: obj.ruleFile as string | undefined,
    inlineRules: obj.inlineRules as string | undefined,
    paths: obj.paths as readonly string[],
    workdir: obj.workdir as string | undefined,
    globs: obj.globs as readonly string[] | undefined,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden as boolean | undefined,
    followSymlinks: obj.followSymlinks as boolean | undefined,
    includeMetadata: (obj.includeMetadata as boolean | undefined) ?? false,
    apply: (obj.apply as boolean | undefined) ?? false,
  };
}

export const scanInputSchema = {
  parse(input: unknown): ScanInput {
    return parseScanInput(input);
  },
};

function sourceArgs(input: ScanInput): string[] {
  return input.ruleFile !== undefined
    ? ["--rule", input.ruleFile]
    : ["--inline-rules", input.inlineRules as string];
}

function scopeArgs(input: ScanInput): string[] {
  const args: string[] = [];
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob);
  if (input.includeHidden) args.push("--no-ignore", "hidden");
  if (input.followSymlinks) args.push("--follow");
  return args;
}

/** Pass 1 is always a non-mutating JSON preview from one explicit rule source. */
export function buildScanArgs(input: ScanInput): string[] {
  return [
    "scan",
    ...sourceArgs(input),
    ...(input.includeMetadata ? ["--include-metadata"] : []),
    "--json=stream",
    ...scopeArgs(input),
    ...input.paths,
  ];
}

/** Pass 2 intentionally has --update-all and no JSON flag: JSON+update only previews. */
export function buildScanApplyArgs(input: ScanInput): string[] {
  return ["scan", ...sourceArgs(input), "--update-all", ...scopeArgs(input), ...input.paths];
}

export interface ScanRuleBlock {
  readonly ruleId: string;
  readonly severity?: string;
  readonly note?: string;
  readonly message?: string;
  readonly labels: readonly unknown[];
  readonly metadata?: unknown;
}

export interface ScanMatch extends NormalizedMatch {
  readonly replacement: string;
  readonly replacementOffsets?: unknown;
  readonly rule: ScanRuleBlock;
}

export type ScanErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "INVALID_ARGUMENT"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "PREVIEW_TRUNCATED"
  | "RULE_PARSE_FAILED"
  | "SG_FAILED"
  | "TIMEOUT";

export type ScanPhase = "preflight" | "preview" | "apply";

export interface ScanSuccessPayload {
  readonly schemaVersion: 1;
  readonly ok: true;
  readonly kind: "scan";
  readonly workdir: string;
  readonly applied: boolean;
  readonly matches: readonly ScanMatch[];
  readonly counts: { readonly plannedMatches: number; readonly plannedFiles: number };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reason: "match_limit" | "output_cap" | "sg_output_truncated" | null;
    readonly maxMatches: number;
    readonly maxPayloadBytes: number;
    readonly salvagedRecords: number;
  };
  readonly application: {
    readonly requested: boolean;
    readonly performed: boolean;
    readonly countsArePreviewBased: true;
    readonly secondPassExitCode: number | null;
  };
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

export interface ScanErrorPayload {
  readonly schemaVersion: 1;
  readonly ok: false;
  readonly kind: "scan";
  readonly error: {
    readonly code: ScanErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly phase: ScanPhase;
    readonly details: { readonly stderr?: string };
  };
  readonly durationMs: number;
}

export type ScanPayload = ScanSuccessPayload | ScanErrorPayload;

const RETRYABLE = new Set<ScanErrorCode>(["ABORTED", "OUTPUT_PARSE_FAILED", "TIMEOUT"]);
const RULE_PARSE_RE = /Cannot parse rule|not a valid ast-grep rule|Fail to parse yaml as RuleConfig/i;
const DEPRECATION_WARNING_RE = /^warning:.*\bsg\b.*deprecated/im;
const APPLY_PREVIEW_WARNING =
  "Mutation counts are based on the preview pass; sg scan --update-all does not return equivalent JSON.";

function failure(
  code: ScanErrorCode,
  message: string,
  phase: ScanPhase,
  durationMs: number,
  details: { stderr?: string } = {},
): ScanErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "scan",
    error: { code, message, retryable: RETRYABLE.has(code), phase, details },
    durationMs,
  };
}

function runnerFailure(error: SgRunnerError, phase: ScanPhase): ScanErrorPayload {
  if (RULE_PARSE_RE.test(error.stderr)) {
    return failure(
      "RULE_PARSE_FAILED",
      "ast-grep could not parse the explicit YAML rule source.",
      phase,
      error.durationMs,
      { stderr: error.stderr },
    );
  }
  return failure(error.code as ScanErrorCode, error.message, phase, error.durationMs, { stderr: error.stderr });
}

function toScanMatches(records: readonly Record<string, unknown>[], workdir: string): ScanMatch[] {
  return normalizeRecords(records, workdir).map((normalized) => {
    const raw = normalized as Record<string, unknown>;
    const rule: ScanRuleBlock = {
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : "",
      ...(typeof raw.severity === "string" ? { severity: raw.severity } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      ...(raw.metadata !== undefined ? { metadata: raw.metadata } : {}),
    };
    const match = { ...raw };
    delete match.ruleId;
    delete match.severity;
    delete match.note;
    delete match.message;
    delete match.labels;
    delete match.metadata;
    return {
      ...match,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      rule,
    } as ScanMatch;
  });
}

export async function executeScan(
  rawInput: unknown,
  sgPath: string,
  signal?: AbortSignal,
): Promise<ScanPayload> {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));

  let input: ScanInput;
  try {
    input = parseScanInput(rawInput);
  } catch (error) {
    return failure(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : String(error),
      "preflight",
      elapsed(),
    );
  }

  const workdir = input.workdir ?? process.env.OMO_AST_GREP_PROJECT_CWD ?? process.cwd();
  let preview: Awaited<ReturnType<typeof spawnSgRunner>>;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildScanArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal,
    });
  } catch (error) {
    if (error instanceof SgRunnerError) return runnerFailure(error, "preview");
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", elapsed());
  }

  const matches = toScanMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords,
  } as const;
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size,
  } as const;
  const warnings = DEPRECATION_WARNING_RE.test(preview.stderr) ? [preview.stderr.trim()] : [];

  const dryRun = (extraWarnings: readonly string[] = []): ScanSuccessPayload => ({
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      secondPassExitCode: null,
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed(),
  });

  if (!input.apply) return dryRun();
  if (preview.truncated) {
    return failure(
      "PREVIEW_TRUNCATED",
      `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`,
      "preview",
      elapsed(),
      { stderr: preview.stderr },
    );
  }
  if (matches.length === 0) return dryRun(["Nothing to apply: the preview found no matches."]);

  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure(
      "TIMEOUT",
      "The tool deadline expired during the preview pass; the mutation pass was not started.",
      "preview",
      elapsed(),
      { stderr: preview.stderr },
    );
  }

  let applied: Awaited<ReturnType<typeof spawnSgRunner>>;
  try {
    applied = await spawnSgRunner({
      sgPath,
      args: buildScanApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal,
    });
  } catch (error) {
    if (error instanceof SgRunnerError) return runnerFailure(error, "apply");
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", elapsed());
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      secondPassExitCode: applied.exitCode,
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed(),
  };
}
