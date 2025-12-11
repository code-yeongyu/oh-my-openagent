import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { README_INJECTOR_STORAGE } from "./constants";
import type { InjectedPathsData } from "./types";

function getStoragePath(sessionID: string): string {
  return join(README_INJECTOR_STORAGE, `${sessionID}.json`);
}

export function loadInjectedPaths(sessionID: string): Set<string> {
  const filePath = getStoragePath(sessionID);
  if (!existsSync(filePath)) return new Set();

  try {
    const content = readFileSync(filePath, "utf-8");
    const data: InjectedPathsData = JSON.parse(content);
    return new Set(data.injectedPaths);
  } catch {
    return new Set();
  }
}

export function saveInjectedPaths(sessionID: string, paths: Set<string>): void {
  if (!existsSync(README_INJECTOR_STORAGE)) {
    mkdirSync(README_INJECTOR_STORAGE, { recursive: true });
  }

  const data: InjectedPathsData = {
    sessionID,
    injectedPaths: [...paths],
    updatedAt: Date.now(),
  };

  writeFileSync(getStoragePath(sessionID), JSON.stringify(data, null, 2));
}

export function clearInjectedPaths(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
