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
  } catch {
    return { contentHashes: new Set(), realPaths: new Set() };
  }
}

export function saveInjectedRules(
  sessionID: string,
  data: { contentHashes: Set<string>; realPaths: Set<string> }
): void {
  if (!existsSync(RULES_INJECTOR_STORAGE)) {
    mkdirSync(RULES_INJECTOR_STORAGE, { recursive: true });
  }

  const storageData: InjectedRulesData = {
    sessionID,
    injectedHashes: [...data.contentHashes],
    injectedRealPaths: [...data.realPaths],
    updatedAt: Date.now(),
  };

  writeFileSync(getStoragePath(sessionID), JSON.stringify(storageData, null, 2));
}

export function clearInjectedRules(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
