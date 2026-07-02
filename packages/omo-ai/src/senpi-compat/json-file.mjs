import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonObject(path, fallback) {
  if (!existsSync(path)) {
    return structuredClone(fallback);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${path} contains invalid JSON. Original parse error: ${originalMessage}`);
  }
  if (!isRecord(parsed)) {
    throw new TypeError(`${path} must contain a JSON object.`);
  }
  return parsed;
}

export function writeJsonObject(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function backupIfPresent(path) {
  if (!existsSync(path)) {
    return undefined;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let backupPath = `${path}.bak.${stamp}`;
  let suffix = 0;
  while (existsSync(backupPath)) {
    suffix += 1;
    backupPath = `${path}.bak.${stamp}.${suffix}`;
  }
  copyFileSync(path, backupPath);
  return backupPath;
}

export function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
