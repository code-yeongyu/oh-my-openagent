import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import { readdirSync, statSync, existsSync } from "node:fs";

export class RecordingLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingLabelError";
  }
}

export function recordingsRoot(): string {
  return join(process.env.HOME || homedir(), "Library", "Caches", "idm", "sessions");
}

export function legacyRecordingPath(sessionId: string): string {
  return join(recordingsRoot(), `${sessionId}.jsonl`);
}

export function enhancedRecordingDir(name: string): string {
  return join(recordingsRoot(), name);
}

export function enhancedRecordingPaths(name: string) {
  const dir = enhancedRecordingDir(name);
  return {
    dir,
    sessionJsonl: join(dir, "session.jsonl"),
    metadataJson: join(dir, "metadata.json"),
    visionCheckpointsDir: join(dir, "vision-checkpoints"),
  };
}

export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function validateLabelOrThrow(label: string): void {
  if (!label) {
    throw new RecordingLabelError("Label cannot be empty");
  }
  if (label.length > 64) {
    throw new RecordingLabelError("Label exceeds 64 characters");
  }
  if (slugifyLabel(label) !== label) {
    throw new RecordingLabelError("Label must be a valid slug (lowercase, alphanumeric, and dashes only)");
  }
}

export function isEnhancedRecording(path: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) return false;
    return existsSync(join(path, "metadata.json"));
  } catch {
    return false;
  }
}

export function isLegacyRecording(path: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return false;
    return extname(path) === ".jsonl";
  } catch {
    return false;
  }
}

export function listRecordings(root: string = recordingsRoot()): Array<{ kind: "enhanced" | "legacy"; name: string; path: string }> {
  if (!existsSync(root)) return [];
  
  const entries = readdirSync(root);
  const results: Array<{ kind: "enhanced" | "legacy"; name: string; path: string }> = [];

  for (const entry of entries) {
    const fullPath = join(root, entry);
    if (isEnhancedRecording(fullPath)) {
      results.push({ kind: "enhanced", name: entry, path: fullPath });
    } else if (isLegacyRecording(fullPath)) {
      results.push({ kind: "legacy", name: basename(entry, ".jsonl"), path: fullPath });
    }
  }

  return results;
}
