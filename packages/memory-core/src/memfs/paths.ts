import { lstatSync, realpathSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";

/**
 * Confined memory path validation.
 *
 * Dual-copy verdict: Letta's memory.ts:346-454 and
 * memory-apply-patch.ts:509-643 implementations are behaviorally identical.
 * They differ only in tool-name error prefixes, comments, and formatting.
 */
export class MemoryPathError extends Error {
  override readonly name = "MemoryPathError";
}

export interface ValidateMemoryPathOptions {
  /** Tool paths are markdown labels; repository paths may target directories. */
  toolPath?: boolean;
  fieldName?: string;
}

export function validateMemoryPath(
  memoryRoot: string,
  inputPath: string,
  options: ValidateMemoryPathOptions = {},
): string {
  const root = resolve(memoryRoot);
  const fieldName = options.fieldName ?? "path";
  const toolPath = options.toolPath ?? true;
  const raw = inputPath.trim();

  if (!raw) {
    throw invalid(`'${fieldName}' must be a non-empty string`);
  }
  if (raw.includes("\0")) {
    throw invalid(`'${fieldName}' contains invalid null bytes`);
  }
  if (raw.startsWith("~/") || raw.startsWith("$HOME/")) {
    throw invalid(
      `'${fieldName}' must be a memory-relative path, not a home-relative filesystem path`,
    );
  }

  const windowsAbsolute = /^[a-zA-Z]:[\\/]/.test(raw);
  let relativeInput = raw;
  if (isAbsolute(raw) || windowsAbsolute) {
    const absoluteInput = resolve(raw);
    const relToMemory = relative(root, absoluteInput);
    if (!isConfinedRelative(relToMemory) || !relToMemory) {
      throw invalid(prefixError(root));
    }
    relativeInput = relToMemory;
  }

  const normalized = normalizeRelativePath(relativeInput, fieldName, toolPath);
  const target = resolve(root, normalized);
  const relToRoot = relative(root, target);
  if (!isConfinedRelative(relToRoot) || !relToRoot) {
    throw invalid("resolved path escapes memory directory");
  }

  assertRealParentConfined(root, target);
  return target;
}

export function validateRepositoryPath(
  memoryRoot: string,
  inputPath: string,
  fieldName = "path",
): string {
  return validateMemoryPath(memoryRoot, inputPath, {
    fieldName,
    toolPath: false,
  });
}

function normalizeRelativePath(
  inputPath: string,
  fieldName: string,
  toolPath: boolean,
): string {
  const normalized = inputPath.trim().replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw invalid(
      `'${fieldName}' must be a relative path like system/contacts.md`,
    );
  }

  let path = normalized.replace(/^memory\//, "");
  if (!path) {
    throw invalid(`'${fieldName}' resolves to an empty memory label`);
  }

  if (toolPath) {
    const extension = extname(path);
    if (extension && extension !== ".md") {
      throw invalid(`'${fieldName}' must target a lowercase .md markdown file`);
    }
    path = path.replace(/\.md$/, "");
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw invalid(`'${fieldName}' resolves to an empty memory label`);
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw invalid(`'${fieldName}' contains invalid path traversal segment`);
    }
    if (segment.includes("\0")) {
      throw invalid(`'${fieldName}' contains invalid null bytes`);
    }
    if (segment.toLowerCase() === ".git") {
      throw invalid(`'${fieldName}' cannot target .git administration paths`);
    }
  }

  const repositoryPath = segments.join("/");
  return toolPath ? `${repositoryPath}.md` : repositoryPath;
}

function assertRealParentConfined(root: string, target: string): void {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch (error) {
    throw invalid(`memory root cannot be resolved: ${errorMessage(error)}`);
  }

  let candidate = target;
  while (true) {
    try {
      lstatSync(candidate);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw invalid(`path ancestor cannot be inspected: ${errorMessage(error)}`);
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw invalid("path has no existing ancestor inside memory root");
      }
      candidate = parent;
      continue;
    }

    let candidateReal: string;
    try {
      candidateReal = realpathSync(candidate);
    } catch (error) {
      throw invalid(`path contains an unresolved symlink: ${errorMessage(error)}`);
    }

    const relToRealRoot = relative(rootReal, candidateReal);
    if (!isConfinedRelative(relToRealRoot)) {
      throw invalid("path escapes memory root through a symlink");
    }
    return;
  }
}

function isConfinedRelative(path: string): boolean {
  return !path.startsWith("..") && !isAbsolute(path);
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function prefixError(root: string): string {
  return `The memory tool can only be used to modify files in {${root}} or provided as a relative path`;
}

function invalid(message: string): MemoryPathError {
  return new MemoryPathError(`memory path: ${message}`);
}
