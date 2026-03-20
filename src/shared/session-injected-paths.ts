import { createSessionStorage } from "./session-storage";

export interface InjectedPathsData {
  sessionID: string;
  injectedPaths: string[];
  updatedAt: number;
}

export function createInjectedPathsStorage(storageDir: string) {
  const storage = createSessionStorage<Set<string>, InjectedPathsData>({
    storageDir,
    defaultValue: new Set(),
    serialize: (paths, sessionID) => ({
      sessionID,
      injectedPaths: [...paths],
      updatedAt: Date.now(),
    }),
    deserialize: (data) => new Set(data.injectedPaths),
  });

  return {
    loadInjectedPaths: storage.load,
    saveInjectedPaths: storage.save,
    clearInjectedPaths: storage.clear,
  };
}
