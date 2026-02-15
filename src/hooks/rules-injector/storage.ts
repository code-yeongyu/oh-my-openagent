import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../shared/json-cache";
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
  const data = readJsonFile<InjectedRulesData>(filePath);
  
  if (!data) {
    return { contentHashes: new Set(), realPaths: new Set() };
  }

  return {
    contentHashes: new Set(data.injectedHashes),
    realPaths: new Set(data.injectedRealPaths ?? []),
  };
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

  writeJsonFile(getStoragePath(sessionID), storageData, { ensureDir: true });
}

export function clearInjectedRules(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
