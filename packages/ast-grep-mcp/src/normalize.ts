import { posix, win32 } from "node:path";

export interface NormalizedPoint {
  readonly line: number;
  readonly column: number;
  readonly byteOffset: number;
}

export interface NormalizedMatch extends Record<string, unknown> {
  readonly path: string;
  readonly language?: string;
  readonly text: string;
  readonly range: { readonly start: NormalizedPoint; readonly end: NormalizedPoint };
  readonly metavariables: {
    readonly single: Readonly<Record<string, string>>;
    readonly multi: Readonly<Record<string, string>>;
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function point(raw: unknown, byteOffset: unknown): NormalizedPoint {
  const value = object(raw, "range point");
  return {
    line: number(value.line, "line") + 1,
    column: number(value.column, "column"),
    byteOffset: number(byteOffset, "byte offset"),
  };
}

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function stablePath(file: string, workdir: string): string {
  if (isWindowsPath(file) || isWindowsPath(workdir)) {
    const root = win32.resolve(workdir);
    const absolute = win32.resolve(root, file);
    const relative = win32.relative(root, absolute);
    const inside = relative === "" || (!relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative));
    return slash(inside ? relative || "." : absolute);
  }
  const root = posix.resolve(workdir);
  const absolute = posix.resolve(root, file);
  const relative = posix.relative(root, absolute);
  const inside = relative === "" || (!relative.startsWith("../") && relative !== ".." && !posix.isAbsolute(relative));
  return inside ? relative || "." : absolute;
}

function nodeText(value: unknown): string {
  if (typeof value === "string") return value;
  const node = object(value, "metavariable node");
  return typeof node.text === "string" ? node.text : "";
}

function nodeByteRange(value: unknown): { start: number; end: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const range = object((value as Record<string, unknown>).range, "metavariable range");
  const bytes = object(range.byteOffset, "metavariable byte range");
  return typeof bytes.start === "number" && typeof bytes.end === "number"
    ? { start: bytes.start, end: bytes.end }
    : null;
}

function normalizeMetavariables(raw: unknown, text: string, matchStart: number) {
  const meta = raw === undefined ? {} : object(raw, "metaVariables");
  const singles = meta.single === undefined ? {} : object(meta.single, "single metavariables");
  const multis = meta.multi === undefined ? {} : object(meta.multi, "multi metavariables");
  const single: Record<string, string> = {};
  const multi: Record<string, string> = {};
  for (const [name, value] of Object.entries(singles)) single[name] = nodeText(value);
  for (const [name, value] of Object.entries(multis)) {
    if (!Array.isArray(value) || value.length === 0) {
      multi[name] = "";
      continue;
    }
    const first = nodeByteRange(value[0]);
    const last = nodeByteRange(value[value.length - 1]);
    const bytes = Buffer.from(text, "utf8");
    const start = (first?.start ?? matchStart) - matchStart;
    const end = (last?.end ?? matchStart) - matchStart;
    multi[name] = start >= 0 && end >= start && end <= bytes.length
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end))
      : value.map(nodeText).join("");
  }
  return { single, multi };
}

export function normalizeMatch(rawValue: Record<string, unknown>, workdir: string): NormalizedMatch {
  const raw = object(rawValue, "ast-grep record");
  const text = typeof raw.text === "string" ? raw.text : "";
  const file = typeof raw.file === "string" ? raw.file : "";
  const range = object(raw.range, "range");
  const bytes = object(range.byteOffset, "byte range");
  const startByte = number(bytes.start, "start byte offset");
  const normalized: Record<string, unknown> = {
    path: stablePath(file, workdir),
    ...(typeof raw.language === "string" ? { language: raw.language.toLowerCase() } : {}),
    text,
    range: {
      start: point(range.start, startByte),
      end: point(range.end, number(bytes.end, "end byte offset")),
    },
    metavariables: normalizeMetavariables(raw.metaVariables, text, startByte),
  };
  const consumed = new Set(["text", "range", "file", "lines", "language", "metaVariables", "charCount", "transformed"]);
  for (const [key, value] of Object.entries(raw)) if (!consumed.has(key)) normalized[key] = value;
  return normalized as NormalizedMatch;
}

export function normalizeRecords(records: readonly Record<string, unknown>[], workdir: string): NormalizedMatch[] {
  return records
    .map((record) => normalizeMatch(record, workdir))
    .sort((left, right) => {
      const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
      return pathOrder || left.range.start.byteOffset - right.range.start.byteOffset;
    });
}
