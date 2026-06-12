import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { RULES_INJECTOR_STORAGE } from "./constants";
import type { InjectedRulesData } from "./types";

function getStoragePath(sessionID: string): string {
  return join(RULES_INJECTOR_STORAGE, `${sessionID}.json`);
}

export function loadInjectedRules(sessionID: string): {
  contentHashes: Set<string>;
  realPaths: Set<string>;
} {
  const filePath = getStoragePath(sessionID);
  if (!existsSync(filePath))
    return { contentHashes: new Set(), realPaths: new Set() };

  try {
    const content = readFileSync(filePath, "utf-8");
    const data: InjectedRulesData = JSON.parse(content);
    return {
      contentHashes: new Set(data.injectedHashes),
      realPaths: new Set(data.injectedRealPaths ?? []),
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return { contentHashes: new Set(), realPaths: new Set() };
  }
}

export function saveInjectedRules(
  sessionID: string,
  data: { contentHashes: Set<string>; realPaths: Set<string> }
): void {
  const storageData: InjectedRulesData = {
    sessionID,
    injectedHashes: [...data.contentHashes],
    injectedRealPaths: [...data.realPaths],
    updatedAt: Date.now(),
  };

  mkdirSync(RULES_INJECTOR_STORAGE, { recursive: true });
  try {
    writeFileSync(getStoragePath(sessionID), JSON.stringify(storageData, null, 2));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
    mkdirSync(RULES_INJECTOR_STORAGE, { recursive: true });
    writeFileSync(getStoragePath(sessionID), JSON.stringify(storageData, null, 2));
  }
}

export function clearInjectedRules(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
