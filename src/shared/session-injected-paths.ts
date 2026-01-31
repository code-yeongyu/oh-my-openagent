import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface InjectedPathsData {
  sessionID: string;
  injectedPaths: string[];
  updatedAt: number;
}

export function createInjectedPathsStorage(storageDir: string) {
  const getStoragePath = (sessionID: string): string =>
    join(storageDir, `${sessionID}.json`);

  const loadInjectedPaths = (sessionID: string): Set<string> => {
    const filePath = getStoragePath(sessionID);
    if (!existsSync(filePath)) return new Set();

    try {
      const content = readFileSync(filePath, "utf-8");
      const data: InjectedPathsData = JSON.parse(content);
      return new Set(data.injectedPaths);
    } catch {
      return new Set();
    }
  };

  const saveInjectedPaths = (sessionID: string, paths: Set<string>): void => {
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    const data: InjectedPathsData = {
      sessionID,
      injectedPaths: [...paths],
      updatedAt: Date.now(),
    };

    writeFileSync(getStoragePath(sessionID), JSON.stringify(data, null, 2));
  };

  const clearInjectedPaths = (sessionID: string): void => {
    const filePath = getStoragePath(sessionID);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  };

  return {
    loadInjectedPaths,
    saveInjectedPaths,
    clearInjectedPaths,
  };
}
