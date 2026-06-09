import { RULES_INJECTOR_STORAGE } from "./constants";
import { createSessionStorage } from "../../shared/session-storage";
import type { InjectedRulesData } from "./types";

type RulesState = { contentHashes: Set<string>; realPaths: Set<string> };

const storage = createSessionStorage<RulesState, InjectedRulesData>({
  storageDir: RULES_INJECTOR_STORAGE,
  defaultValue: { contentHashes: new Set(), realPaths: new Set() },
  onParseError: "rethrow-non-error",
  retryOnENOENT: true,
  serialize: (state, sessionID) => ({
    sessionID,
    injectedHashes: [...state.contentHashes],
    injectedRealPaths: [...state.realPaths],
    updatedAt: Date.now(),
  }),
  deserialize: (data) => ({
    contentHashes: new Set(data.injectedHashes),
    realPaths: new Set(data.injectedRealPaths ?? []),
  }),
});

export const loadInjectedRules = storage.load;
export const saveInjectedRules = storage.save;
export const clearInjectedRules = storage.clear;
